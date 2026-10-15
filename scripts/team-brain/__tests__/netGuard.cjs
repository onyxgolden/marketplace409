// Team Brain slice 1 — network-deny preload for the isolation test (AC-23).
// Loaded with NODE_OPTIONS="--require <this file>" when spawning the fixture
// CLI as a subprocess. Any TCP connect, DNS lookup, fetch(), or http/https
// request throws, so a clean exit proves the slice performs zero network or
// model calls.

"use strict";

const BLOCKED = new Error("NETWORK BLOCKED by team-brain net guard");

const net = require("node:net");
const dns = require("node:dns");
const http = require("node:http");
const https = require("node:https");

net.Socket.prototype.connect = function blockedConnect() {
  throw BLOCKED;
};

for (const fn of ["lookup", "resolve", "resolve4", "resolve6"]) {
  if (typeof dns[fn] === "function") {
    dns[fn] = function blockedDns(...args) {
      const cb = args[args.length - 1];
      if (typeof cb === "function") cb(BLOCKED);
      else throw BLOCKED;
    };
  }
}

globalThis.fetch = async function blockedFetch() {
  throw BLOCKED;
};

for (const mod of [http, https]) {
  mod.request = function blockedRequest() {
    throw BLOCKED;
  };
  mod.get = function blockedGet() {
    throw BLOCKED;
  };
}
