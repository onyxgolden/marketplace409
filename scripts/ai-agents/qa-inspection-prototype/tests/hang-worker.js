/**
 * hang-worker.js — deliberately never responds. Used ONLY by the watchdog
 * regression test to prove the host terminates a stuck worker with a named
 * incomplete failure instead of hanging or reporting success.
 *
 * The interval keeps the event loop alive forever; nothing is ever posted.
 */
import { workerData } from "node:worker_threads";

if (workerData?.hang) {
  setInterval(() => {}, 1000);
}
