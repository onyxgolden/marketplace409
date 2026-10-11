#!/usr/bin/env python3
"""Sandbox driver: OS-enforced isolation for one payload run.
Runs as host root. Forks a child that unshares user+mount+net namespaces;
the driver writes the child's uid/gid map, then the child (still pre-exec,
therefore holding full namespace capabilities — exec would clear them for a
non-zero uid) builds the mount sandbox via direct syscalls. No setuid
binaries are used inside: they lose privilege across exec.

Two phases, split at the privilege drop:
  SETUP (trusted driver code only, never candidate code): the child is uid 0
    inside the new user namespace, mapped to outer uid 0, so it can create
    the /work mountpoint and install mounts. It makes the mount tree
    private, bind-mounts <scratch_dir> read-write at /work, covers /home,
    /root, /tmp with fresh noexec tmpfs, mounts an empty tmpfs over /proc
    (no host process visibility at all), remounts / read-only, and chowns
    /tmp to the unprivileged uid.
  PAYLOAD: the child setuid/setgid's to inner uid/gid 65534 (mapped to
    outer 65534/nobody), which clears every capability, applies rlimits
    (RLIMIT_AS 2 GiB, RLIMIT_NPROC 64, RLIMIT_FSIZE 64 MiB, RLIMIT_NOFILE 64,
    no core), chdir("/work"), closes stdin, scrubs the environment, and
    execs the payload. Candidate code ONLY ever runs in this phase: fully
    unprivileged, no network (net ns, no interfaces), read-only host fs,
    tmpfs-hidden home/root/tmp/proc (no credential mounts), scratch-only
    writes at /work, scrubbed env. A namespace escape from the payload
    phase yields outer uid 65534 (nobody), never host root.

Protocol: argv = <scratch-dir> <payload...>. Exit status = payload's.
"""
import ctypes
import os
import sys

CLONE_NEWUSER = 0x10000000
CLONE_NEWNS = 0x00020000
CLONE_NEWNET = 0x40000000
MS_BIND, MS_REMOUNT, MS_RDONLY = 4096, 32, 1
MS_PRIVATE, MS_REC = 1 << 18, 16384
MS_NODEV, MS_NOSUID, MS_NOEXEC = 4, 2, 8

libc = ctypes.CDLL("libc.so.6", use_errno=True)

def mount(src, tgt, fstype, flags):
    s = src.encode() if isinstance(src, str) else src
    t = tgt.encode() if isinstance(tgt, str) else tgt
    f = fstype.encode() if isinstance(fstype, str) else fstype
    ctypes.set_errno(0)
    if libc.mount(s, t, f, flags, None) != 0:
        err = ctypes.get_errno()
        raise OSError(err, f"mount {tgt}: {os.strerror(err)}")

def child_main(scratch, payload, ready_w, go_r):
    os.close(ready_w[0]); os.close(go_r[1])
    # Still outer root here. Unshare first; the parent installs the uid/gid
    # map ("0 0 1" + "65534 65534 1") while we block on the go pipe.
    if libc.unshare(CLONE_NEWUSER | CLONE_NEWNS | CLONE_NEWNET) != 0:
        os._exit(10)
    os.write(ready_w[1], b"r"); os.close(ready_w[1])
    if not os.read(go_r[0], 1):
        os._exit(11)
    os.close(go_r[0])
    # SETUP PHASE (trusted driver code only): we are uid 0 inside the new
    # user namespace, mapped to outer uid 0, with full namespace
    # capabilities — no exec has happened. Build the sandbox.
    # Contain mount propagation if the host uses shared mounts; best-effort
    # because / may be owned by the outer userns (the probe fails closed when
    # the host actually uses shared propagation).
    try:
        mount(None, "/", None, MS_PRIVATE | MS_REC)
    except OSError:
        pass
    os.makedirs("/work", exist_ok=True)
    mount(scratch, "/work", None, MS_BIND)
    for p in ("/home", "/root"):
        mount("tmpfs", p, "tmpfs", MS_NODEV | MS_NOSUID | MS_NOEXEC)
    mount("tmpfs", "/tmp", "tmpfs", MS_NODEV | MS_NOSUID)
    # /tmp must stay writable for the unprivileged payload (TMPDIR).
    os.chown("/tmp", 65534, 65534)
    # Empty tmpfs over /proc: the payload sees zero host processes.
    mount("tmpfs", "/proc", "tmpfs", MS_NODEV | MS_NOSUID | MS_NOEXEC)
    mount(None, "/", None, MS_BIND | MS_REMOUNT | MS_RDONLY)
    # PAYLOAD PHASE: drop every privilege before exec. Inner uid/gid 65534
    # map to outer 65534 (nobody); the uid change clears all capabilities.
    # Candidate code only ever runs from here on, fully unprivileged.
    os.setgid(65534)
    os.setuid(65534)
    import resource
    # Node/V8 reserves large virtual space at startup, so the address-space
    # cap is generous; the JS heap is capped separately via
    # --max-old-space-size=512 in the fixed profile argv. nproc/fsize/nofile
    # contain fork bombs, disk floods and fd exhaustion.
    GiB = 1024 * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (2 * GiB, 2 * GiB))
    resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024, 64 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    os.chdir("/work")
    devnull = os.open("/dev/null", os.O_RDONLY)
    os.dup2(devnull, 0)
    env = {"PATH": "/usr/bin:/bin", "HOME": "/nonexistent", "SANDBOX": "1"}
    os.execve(payload[0], payload, env)
    os._exit(13)

def main():
    scratch, payload = sys.argv[1], sys.argv[2:]
    if os.geteuid() != 0:
        sys.stderr.write("driver: must run as root to write the uid_map\n")
        sys.exit(22)
    ready_r, ready_w = os.pipe()
    go_r, go_w = os.pipe()
    pid = os.fork()
    if pid == 0:
        child_main(scratch, payload, (ready_r, ready_w), (go_r, go_w))
        os._exit(14)  # unreachable
    os.close(ready_w); os.close(go_r)
    if not os.read(ready_r, 1):
        sys.stderr.write("driver: child died before ready\n")
        sys.exit(20)
    os.close(ready_r)
    # Two-entry map (parent is privileged, so no subuid config is needed):
    # inner uid 0 -> outer uid 0 lets the trusted setup phase create the
    # /work mountpoint and install mounts; inner uid/gid 65534 -> outer
    # 65534 (nobody) is what the payload runs as after the privilege drop,
    # so a namespace escape from candidate code yields an unprivileged uid.
    try:
        open(f"/proc/{pid}/setgroups", "w").write("deny")
        open(f"/proc/{pid}/uid_map", "w").write("0 0 1\n65534 65534 1\n")
        open(f"/proc/{pid}/gid_map", "w").write("0 0 1\n65534 65534 1\n")
    except OSError as e:
        sys.stderr.write(f"driver: map write failed: {e}\n")
        sys.exit(21)
    os.write(go_w, b"g"); os.close(go_w)
    _, status = os.waitpid(pid, 0)
    sys.exit(os.waitstatus_to_exitcode(status))

if __name__ == "__main__":
    main()
