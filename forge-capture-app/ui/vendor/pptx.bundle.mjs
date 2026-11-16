var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to2, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to2, key) && key !== except)
        __defProp(to2, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to2;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/jszip/dist/jszip.min.js
var require_jszip_min = __commonJS({
  "node_modules/jszip/dist/jszip.min.js"(exports2, module) {
    !(function(e) {
      if ("object" == typeof exports2 && "undefined" != typeof module) module.exports = e();
      else if ("function" == typeof define && define.amd) define([], e);
      else {
        ("undefined" != typeof window ? window : "undefined" != typeof global ? global : "undefined" != typeof self ? self : this).JSZip = e();
      }
    })(function() {
      return (function s2(a, o, h) {
        function u(r, e2) {
          if (!o[r]) {
            if (!a[r]) {
              var t = "function" == typeof __require && __require;
              if (!e2 && t) return t(r, true);
              if (l) return l(r, true);
              var n = new Error("Cannot find module '" + r + "'");
              throw n.code = "MODULE_NOT_FOUND", n;
            }
            var i = o[r] = { exports: {} };
            a[r][0].call(i.exports, function(e3) {
              var t2 = a[r][1][e3];
              return u(t2 || e3);
            }, i, i.exports, s2, a, o, h);
          }
          return o[r].exports;
        }
        for (var l = "function" == typeof __require && __require, e = 0; e < h.length; e++) u(h[e]);
        return u;
      })({ 1: [function(e, t, r) {
        "use strict";
        var d2 = e("./utils"), c = e("./support"), p = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        r.encode = function(e2) {
          for (var t2, r2, n, i, s2, a, o, h = [], u = 0, l = e2.length, f = l, c2 = "string" !== d2.getTypeOf(e2); u < e2.length; ) f = l - u, n = c2 ? (t2 = e2[u++], r2 = u < l ? e2[u++] : 0, u < l ? e2[u++] : 0) : (t2 = e2.charCodeAt(u++), r2 = u < l ? e2.charCodeAt(u++) : 0, u < l ? e2.charCodeAt(u++) : 0), i = t2 >> 2, s2 = (3 & t2) << 4 | r2 >> 4, a = 1 < f ? (15 & r2) << 2 | n >> 6 : 64, o = 2 < f ? 63 & n : 64, h.push(p.charAt(i) + p.charAt(s2) + p.charAt(a) + p.charAt(o));
          return h.join("");
        }, r.decode = function(e2) {
          var t2, r2, n, i, s2, a, o = 0, h = 0, u = "data:";
          if (e2.substr(0, u.length) === u) throw new Error("Invalid base64 input, it looks like a data url.");
          var l, f = 3 * (e2 = e2.replace(/[^A-Za-z0-9+/=]/g, "")).length / 4;
          if (e2.charAt(e2.length - 1) === p.charAt(64) && f--, e2.charAt(e2.length - 2) === p.charAt(64) && f--, f % 1 != 0) throw new Error("Invalid base64 input, bad content length.");
          for (l = c.uint8array ? new Uint8Array(0 | f) : new Array(0 | f); o < e2.length; ) t2 = p.indexOf(e2.charAt(o++)) << 2 | (i = p.indexOf(e2.charAt(o++))) >> 4, r2 = (15 & i) << 4 | (s2 = p.indexOf(e2.charAt(o++))) >> 2, n = (3 & s2) << 6 | (a = p.indexOf(e2.charAt(o++))), l[h++] = t2, 64 !== s2 && (l[h++] = r2), 64 !== a && (l[h++] = n);
          return l;
        };
      }, { "./support": 30, "./utils": 32 }], 2: [function(e, t, r) {
        "use strict";
        var n = e("./external"), i = e("./stream/DataWorker"), s2 = e("./stream/Crc32Probe"), a = e("./stream/DataLengthProbe");
        function o(e2, t2, r2, n2, i2) {
          this.compressedSize = e2, this.uncompressedSize = t2, this.crc32 = r2, this.compression = n2, this.compressedContent = i2;
        }
        o.prototype = { getContentWorker: function() {
          var e2 = new i(n.Promise.resolve(this.compressedContent)).pipe(this.compression.uncompressWorker()).pipe(new a("data_length")), t2 = this;
          return e2.on("end", function() {
            if (this.streamInfo.data_length !== t2.uncompressedSize) throw new Error("Bug : uncompressed data size mismatch");
          }), e2;
        }, getCompressedWorker: function() {
          return new i(n.Promise.resolve(this.compressedContent)).withStreamInfo("compressedSize", this.compressedSize).withStreamInfo("uncompressedSize", this.uncompressedSize).withStreamInfo("crc32", this.crc32).withStreamInfo("compression", this.compression);
        } }, o.createWorkerFrom = function(e2, t2, r2) {
          return e2.pipe(new s2()).pipe(new a("uncompressedSize")).pipe(t2.compressWorker(r2)).pipe(new a("compressedSize")).withStreamInfo("compression", t2);
        }, t.exports = o;
      }, { "./external": 6, "./stream/Crc32Probe": 25, "./stream/DataLengthProbe": 26, "./stream/DataWorker": 27 }], 3: [function(e, t, r) {
        "use strict";
        var n = e("./stream/GenericWorker");
        r.STORE = { magic: "\0\0", compressWorker: function() {
          return new n("STORE compression");
        }, uncompressWorker: function() {
          return new n("STORE decompression");
        } }, r.DEFLATE = e("./flate");
      }, { "./flate": 7, "./stream/GenericWorker": 28 }], 4: [function(e, t, r) {
        "use strict";
        var n = e("./utils");
        var o = (function() {
          for (var e2, t2 = [], r2 = 0; r2 < 256; r2++) {
            e2 = r2;
            for (var n2 = 0; n2 < 8; n2++) e2 = 1 & e2 ? 3988292384 ^ e2 >>> 1 : e2 >>> 1;
            t2[r2] = e2;
          }
          return t2;
        })();
        t.exports = function(e2, t2) {
          return void 0 !== e2 && e2.length ? "string" !== n.getTypeOf(e2) ? (function(e3, t3, r2, n2) {
            var i = o, s2 = n2 + r2;
            e3 ^= -1;
            for (var a = n2; a < s2; a++) e3 = e3 >>> 8 ^ i[255 & (e3 ^ t3[a])];
            return -1 ^ e3;
          })(0 | t2, e2, e2.length, 0) : (function(e3, t3, r2, n2) {
            var i = o, s2 = n2 + r2;
            e3 ^= -1;
            for (var a = n2; a < s2; a++) e3 = e3 >>> 8 ^ i[255 & (e3 ^ t3.charCodeAt(a))];
            return -1 ^ e3;
          })(0 | t2, e2, e2.length, 0) : 0;
        };
      }, { "./utils": 32 }], 5: [function(e, t, r) {
        "use strict";
        r.base64 = false, r.binary = false, r.dir = false, r.createFolders = true, r.date = null, r.compression = null, r.compressionOptions = null, r.comment = null, r.unixPermissions = null, r.dosPermissions = null;
      }, {}], 6: [function(e, t, r) {
        "use strict";
        var n = null;
        n = "undefined" != typeof Promise ? Promise : e("lie"), t.exports = { Promise: n };
      }, { lie: 37 }], 7: [function(e, t, r) {
        "use strict";
        var n = "undefined" != typeof Uint8Array && "undefined" != typeof Uint16Array && "undefined" != typeof Uint32Array, i = e("pako"), s2 = e("./utils"), a = e("./stream/GenericWorker"), o = n ? "uint8array" : "array";
        function h(e2, t2) {
          a.call(this, "FlateWorker/" + e2), this._pako = null, this._pakoAction = e2, this._pakoOptions = t2, this.meta = {};
        }
        r.magic = "\b\0", s2.inherits(h, a), h.prototype.processChunk = function(e2) {
          this.meta = e2.meta, null === this._pako && this._createPako(), this._pako.push(s2.transformTo(o, e2.data), false);
        }, h.prototype.flush = function() {
          a.prototype.flush.call(this), null === this._pako && this._createPako(), this._pako.push([], true);
        }, h.prototype.cleanUp = function() {
          a.prototype.cleanUp.call(this), this._pako = null;
        }, h.prototype._createPako = function() {
          this._pako = new i[this._pakoAction]({ raw: true, level: this._pakoOptions.level || -1 });
          var t2 = this;
          this._pako.onData = function(e2) {
            t2.push({ data: e2, meta: t2.meta });
          };
        }, r.compressWorker = function(e2) {
          return new h("Deflate", e2);
        }, r.uncompressWorker = function() {
          return new h("Inflate", {});
        };
      }, { "./stream/GenericWorker": 28, "./utils": 32, pako: 38 }], 8: [function(e, t, r) {
        "use strict";
        function A(e2, t2) {
          var r2, n2 = "";
          for (r2 = 0; r2 < t2; r2++) n2 += String.fromCharCode(255 & e2), e2 >>>= 8;
          return n2;
        }
        function n(e2, t2, r2, n2, i2, s3) {
          var a, o, h = e2.file, u = e2.compression, l = s3 !== O.utf8encode, f = I2.transformTo("string", s3(h.name)), c = I2.transformTo("string", O.utf8encode(h.name)), d2 = h.comment, p = I2.transformTo("string", s3(d2)), m = I2.transformTo("string", O.utf8encode(d2)), _ = c.length !== h.name.length, g = m.length !== d2.length, b = "", v2 = "", y2 = "", w2 = h.dir, k = h.date, x = { crc32: 0, compressedSize: 0, uncompressedSize: 0 };
          t2 && !r2 || (x.crc32 = e2.crc32, x.compressedSize = e2.compressedSize, x.uncompressedSize = e2.uncompressedSize);
          var S2 = 0;
          t2 && (S2 |= 8), l || !_ && !g || (S2 |= 2048);
          var z2 = 0, C2 = 0;
          w2 && (z2 |= 16), "UNIX" === i2 ? (C2 = 798, z2 |= (function(e3, t3) {
            var r3 = e3;
            return e3 || (r3 = t3 ? 16893 : 33204), (65535 & r3) << 16;
          })(h.unixPermissions, w2)) : (C2 = 20, z2 |= (function(e3) {
            return 63 & (e3 || 0);
          })(h.dosPermissions)), a = k.getUTCHours(), a <<= 6, a |= k.getUTCMinutes(), a <<= 5, a |= k.getUTCSeconds() / 2, o = k.getUTCFullYear() - 1980, o <<= 4, o |= k.getUTCMonth() + 1, o <<= 5, o |= k.getUTCDate(), _ && (v2 = A(1, 1) + A(B(f), 4) + c, b += "up" + A(v2.length, 2) + v2), g && (y2 = A(1, 1) + A(B(p), 4) + m, b += "uc" + A(y2.length, 2) + y2);
          var E = "";
          return E += "\n\0", E += A(S2, 2), E += u.magic, E += A(a, 2), E += A(o, 2), E += A(x.crc32, 4), E += A(x.compressedSize, 4), E += A(x.uncompressedSize, 4), E += A(f.length, 2), E += A(b.length, 2), { fileRecord: R.LOCAL_FILE_HEADER + E + f + b, dirRecord: R.CENTRAL_FILE_HEADER + A(C2, 2) + E + A(p.length, 2) + "\0\0\0\0" + A(z2, 4) + A(n2, 4) + f + b + p };
        }
        var I2 = e("../utils"), i = e("../stream/GenericWorker"), O = e("../utf8"), B = e("../crc32"), R = e("../signature");
        function s2(e2, t2, r2, n2) {
          i.call(this, "ZipFileWorker"), this.bytesWritten = 0, this.zipComment = t2, this.zipPlatform = r2, this.encodeFileName = n2, this.streamFiles = e2, this.accumulate = false, this.contentBuffer = [], this.dirRecords = [], this.currentSourceOffset = 0, this.entriesCount = 0, this.currentFile = null, this._sources = [];
        }
        I2.inherits(s2, i), s2.prototype.push = function(e2) {
          var t2 = e2.meta.percent || 0, r2 = this.entriesCount, n2 = this._sources.length;
          this.accumulate ? this.contentBuffer.push(e2) : (this.bytesWritten += e2.data.length, i.prototype.push.call(this, { data: e2.data, meta: { currentFile: this.currentFile, percent: r2 ? (t2 + 100 * (r2 - n2 - 1)) / r2 : 100 } }));
        }, s2.prototype.openedSource = function(e2) {
          this.currentSourceOffset = this.bytesWritten, this.currentFile = e2.file.name;
          var t2 = this.streamFiles && !e2.file.dir;
          if (t2) {
            var r2 = n(e2, t2, false, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
            this.push({ data: r2.fileRecord, meta: { percent: 0 } });
          } else this.accumulate = true;
        }, s2.prototype.closedSource = function(e2) {
          this.accumulate = false;
          var t2 = this.streamFiles && !e2.file.dir, r2 = n(e2, t2, true, this.currentSourceOffset, this.zipPlatform, this.encodeFileName);
          if (this.dirRecords.push(r2.dirRecord), t2) this.push({ data: (function(e3) {
            return R.DATA_DESCRIPTOR + A(e3.crc32, 4) + A(e3.compressedSize, 4) + A(e3.uncompressedSize, 4);
          })(e2), meta: { percent: 100 } });
          else for (this.push({ data: r2.fileRecord, meta: { percent: 0 } }); this.contentBuffer.length; ) this.push(this.contentBuffer.shift());
          this.currentFile = null;
        }, s2.prototype.flush = function() {
          for (var e2 = this.bytesWritten, t2 = 0; t2 < this.dirRecords.length; t2++) this.push({ data: this.dirRecords[t2], meta: { percent: 100 } });
          var r2 = this.bytesWritten - e2, n2 = (function(e3, t3, r3, n3, i2) {
            var s3 = I2.transformTo("string", i2(n3));
            return R.CENTRAL_DIRECTORY_END + "\0\0\0\0" + A(e3, 2) + A(e3, 2) + A(t3, 4) + A(r3, 4) + A(s3.length, 2) + s3;
          })(this.dirRecords.length, r2, e2, this.zipComment, this.encodeFileName);
          this.push({ data: n2, meta: { percent: 100 } });
        }, s2.prototype.prepareNextSource = function() {
          this.previous = this._sources.shift(), this.openedSource(this.previous.streamInfo), this.isPaused ? this.previous.pause() : this.previous.resume();
        }, s2.prototype.registerPrevious = function(e2) {
          this._sources.push(e2);
          var t2 = this;
          return e2.on("data", function(e3) {
            t2.processChunk(e3);
          }), e2.on("end", function() {
            t2.closedSource(t2.previous.streamInfo), t2._sources.length ? t2.prepareNextSource() : t2.end();
          }), e2.on("error", function(e3) {
            t2.error(e3);
          }), this;
        }, s2.prototype.resume = function() {
          return !!i.prototype.resume.call(this) && (!this.previous && this._sources.length ? (this.prepareNextSource(), true) : this.previous || this._sources.length || this.generatedError ? void 0 : (this.end(), true));
        }, s2.prototype.error = function(e2) {
          var t2 = this._sources;
          if (!i.prototype.error.call(this, e2)) return false;
          for (var r2 = 0; r2 < t2.length; r2++) try {
            t2[r2].error(e2);
          } catch (e3) {
          }
          return true;
        }, s2.prototype.lock = function() {
          i.prototype.lock.call(this);
          for (var e2 = this._sources, t2 = 0; t2 < e2.length; t2++) e2[t2].lock();
        }, t.exports = s2;
      }, { "../crc32": 4, "../signature": 23, "../stream/GenericWorker": 28, "../utf8": 31, "../utils": 32 }], 9: [function(e, t, r) {
        "use strict";
        var u = e("../compressions"), n = e("./ZipFileWorker");
        r.generateWorker = function(e2, a, t2) {
          var o = new n(a.streamFiles, t2, a.platform, a.encodeFileName), h = 0;
          try {
            e2.forEach(function(e3, t3) {
              h++;
              var r2 = (function(e4, t4) {
                var r3 = e4 || t4, n3 = u[r3];
                if (!n3) throw new Error(r3 + " is not a valid compression method !");
                return n3;
              })(t3.options.compression, a.compression), n2 = t3.options.compressionOptions || a.compressionOptions || {}, i = t3.dir, s2 = t3.date;
              t3._compressWorker(r2, n2).withStreamInfo("file", { name: e3, dir: i, date: s2, comment: t3.comment || "", unixPermissions: t3.unixPermissions, dosPermissions: t3.dosPermissions }).pipe(o);
            }), o.entriesCount = h;
          } catch (e3) {
            o.error(e3);
          }
          return o;
        };
      }, { "../compressions": 3, "./ZipFileWorker": 8 }], 10: [function(e, t, r) {
        "use strict";
        function n() {
          if (!(this instanceof n)) return new n();
          if (arguments.length) throw new Error("The constructor with parameters has been removed in JSZip 3.0, please check the upgrade guide.");
          this.files = /* @__PURE__ */ Object.create(null), this.comment = null, this.root = "", this.clone = function() {
            var e2 = new n();
            for (var t2 in this) "function" != typeof this[t2] && (e2[t2] = this[t2]);
            return e2;
          };
        }
        (n.prototype = e("./object")).loadAsync = e("./load"), n.support = e("./support"), n.defaults = e("./defaults"), n.version = "3.10.2", n.loadAsync = function(e2, t2) {
          return new n().loadAsync(e2, t2);
        }, n.external = e("./external"), t.exports = n;
      }, { "./defaults": 5, "./external": 6, "./load": 11, "./object": 15, "./support": 30 }], 11: [function(e, t, r) {
        "use strict";
        var u = e("./utils"), i = e("./external"), n = e("./utf8"), s2 = e("./zipEntries"), a = e("./stream/Crc32Probe"), l = e("./nodejsUtils");
        function f(n2) {
          return new i.Promise(function(e2, t2) {
            var r2 = n2.decompressed.getContentWorker().pipe(new a());
            r2.on("error", function(e3) {
              t2(e3);
            }).on("end", function() {
              r2.streamInfo.crc32 !== n2.decompressed.crc32 ? t2(new Error("Corrupted zip : CRC32 mismatch")) : e2();
            }).resume();
          });
        }
        t.exports = function(e2, o) {
          var h = this;
          return o = u.extend(o || {}, { base64: false, checkCRC32: false, optimizedBinaryString: false, createFolders: false, decodeFileName: n.utf8decode }), l.isNode && l.isStream(e2) ? i.Promise.reject(new Error("JSZip can't accept a stream when loading a zip file.")) : u.prepareContent("the loaded zip file", e2, true, o.optimizedBinaryString, o.base64).then(function(e3) {
            var t2 = new s2(o);
            return t2.load(e3), t2;
          }).then(function(e3) {
            var t2 = [i.Promise.resolve(e3)], r2 = e3.files;
            if (o.checkCRC32) for (var n2 = 0; n2 < r2.length; n2++) t2.push(f(r2[n2]));
            return i.Promise.all(t2);
          }).then(function(e3) {
            for (var t2 = e3.shift(), r2 = t2.files, n2 = 0; n2 < r2.length; n2++) {
              var i2 = r2[n2], s3 = i2.fileNameStr, a2 = u.resolve(i2.fileNameStr);
              h.file(a2, i2.decompressed, { binary: true, optimizedBinaryString: true, date: i2.date, dir: i2.dir, comment: i2.fileCommentStr.length ? i2.fileCommentStr : null, unixPermissions: i2.unixPermissions, dosPermissions: i2.dosPermissions, createFolders: o.createFolders }), i2.dir || (h.file(a2).unsafeOriginalName = s3);
            }
            return t2.zipComment.length && (h.comment = t2.zipComment), h;
          });
        };
      }, { "./external": 6, "./nodejsUtils": 14, "./stream/Crc32Probe": 25, "./utf8": 31, "./utils": 32, "./zipEntries": 33 }], 12: [function(e, t, r) {
        "use strict";
        var n = e("../utils"), i = e("../stream/GenericWorker");
        function s2(e2, t2) {
          i.call(this, "Nodejs stream input adapter for " + e2), this._upstreamEnded = false, this._bindStream(t2);
        }
        n.inherits(s2, i), s2.prototype._bindStream = function(e2) {
          var t2 = this;
          (this._stream = e2).pause(), e2.on("data", function(e3) {
            t2.push({ data: e3, meta: { percent: 0 } });
          }).on("error", function(e3) {
            t2.isPaused ? this.generatedError = e3 : t2.error(e3);
          }).on("end", function() {
            t2.isPaused ? t2._upstreamEnded = true : t2.end();
          });
        }, s2.prototype.pause = function() {
          return !!i.prototype.pause.call(this) && (this._stream.pause(), true);
        }, s2.prototype.resume = function() {
          return !!i.prototype.resume.call(this) && (this._upstreamEnded ? this.end() : this._stream.resume(), true);
        }, t.exports = s2;
      }, { "../stream/GenericWorker": 28, "../utils": 32 }], 13: [function(e, t, r) {
        "use strict";
        var i = e("readable-stream").Readable;
        function n(e2, t2, r2) {
          i.call(this, t2), this._helper = e2;
          var n2 = this;
          e2.on("data", function(e3, t3) {
            n2.push(e3) || n2._helper.pause(), r2 && r2(t3);
          }).on("error", function(e3) {
            n2.emit("error", e3);
          }).on("end", function() {
            n2.push(null);
          });
        }
        e("../utils").inherits(n, i), n.prototype._read = function() {
          this._helper.resume();
        }, t.exports = n;
      }, { "../utils": 32, "readable-stream": 16 }], 14: [function(e, t, r) {
        "use strict";
        t.exports = { isNode: "undefined" != typeof Buffer, newBufferFrom: function(e2, t2) {
          if (Buffer.from && Buffer.from !== Uint8Array.from) return Buffer.from(e2, t2);
          if ("number" == typeof e2) throw new Error('The "data" argument must not be a number');
          return new Buffer(e2, t2);
        }, allocBuffer: function(e2) {
          if (Buffer.alloc) return Buffer.alloc(e2);
          var t2 = new Buffer(e2);
          return t2.fill(0), t2;
        }, isBuffer: function(e2) {
          return Buffer.isBuffer(e2);
        }, isStream: function(e2) {
          return e2 && "function" == typeof e2.on && "function" == typeof e2.pause && "function" == typeof e2.resume;
        } };
      }, {}], 15: [function(e, t, r) {
        "use strict";
        function s2(e2, t2, r2) {
          var n2, i2 = u.getTypeOf(t2), s3 = u.extend(r2 || {}, f);
          s3.date = s3.date || /* @__PURE__ */ new Date(), null !== s3.compression && (s3.compression = s3.compression.toUpperCase()), "string" == typeof s3.unixPermissions && (s3.unixPermissions = parseInt(s3.unixPermissions, 8)), s3.unixPermissions && 16384 & s3.unixPermissions && (s3.dir = true), s3.dosPermissions && 16 & s3.dosPermissions && (s3.dir = true), s3.dir && (e2 = g(e2)), s3.createFolders && (n2 = _(e2)) && b.call(this, n2, true);
          var a2 = "string" === i2 && false === s3.binary && false === s3.base64;
          r2 && void 0 !== r2.binary || (s3.binary = !a2), (t2 instanceof c && 0 === t2.uncompressedSize || s3.dir || !t2 || 0 === t2.length) && (s3.base64 = false, s3.binary = true, t2 = "", s3.compression = "STORE", i2 = "string");
          var o2 = null;
          o2 = t2 instanceof c || t2 instanceof l ? t2 : p.isNode && p.isStream(t2) ? new m(e2, t2) : u.prepareContent(e2, t2, s3.binary, s3.optimizedBinaryString, s3.base64);
          var h2 = new d2(e2, o2, s3);
          this.files[e2] = h2;
        }
        var i = e("./utf8"), u = e("./utils"), l = e("./stream/GenericWorker"), a = e("./stream/StreamHelper"), f = e("./defaults"), c = e("./compressedObject"), d2 = e("./zipObject"), o = e("./generate"), p = e("./nodejsUtils"), m = e("./nodejs/NodejsStreamInputAdapter"), _ = function(e2) {
          "/" === e2.slice(-1) && (e2 = e2.substring(0, e2.length - 1));
          var t2 = e2.lastIndexOf("/");
          return 0 < t2 ? e2.substring(0, t2) : "";
        }, g = function(e2) {
          return "/" !== e2.slice(-1) && (e2 += "/"), e2;
        }, b = function(e2, t2) {
          return t2 = void 0 !== t2 ? t2 : f.createFolders, e2 = g(e2), this.files[e2] || s2.call(this, e2, null, { dir: true, createFolders: t2 }), this.files[e2];
        };
        function h(e2) {
          return "[object RegExp]" === Object.prototype.toString.call(e2);
        }
        var n = { load: function() {
          throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
        }, forEach: function(e2) {
          var t2, r2, n2;
          for (t2 in this.files) n2 = this.files[t2], (r2 = t2.slice(this.root.length, t2.length)) && t2.slice(0, this.root.length) === this.root && e2(r2, n2);
        }, filter: function(r2) {
          var n2 = [];
          return this.forEach(function(e2, t2) {
            r2(e2, t2) && n2.push(t2);
          }), n2;
        }, file: function(e2, t2, r2) {
          if (1 !== arguments.length) return e2 = this.root + e2, s2.call(this, e2, t2, r2), this;
          if (h(e2)) {
            var n2 = e2;
            return this.filter(function(e3, t3) {
              return !t3.dir && n2.test(e3);
            });
          }
          var i2 = this.files[this.root + e2];
          return i2 && !i2.dir ? i2 : null;
        }, folder: function(r2) {
          if (!r2) return this;
          if (h(r2)) return this.filter(function(e3, t3) {
            return t3.dir && r2.test(e3);
          });
          var e2 = this.root + r2, t2 = b.call(this, e2), n2 = this.clone();
          return n2.root = t2.name, n2;
        }, remove: function(r2) {
          r2 = this.root + r2;
          var e2 = this.files[r2];
          if (e2 || ("/" !== r2.slice(-1) && (r2 += "/"), e2 = this.files[r2]), e2 && !e2.dir) delete this.files[r2];
          else for (var t2 = this.filter(function(e3, t3) {
            return t3.name.slice(0, r2.length) === r2;
          }), n2 = 0; n2 < t2.length; n2++) delete this.files[t2[n2].name];
          return this;
        }, generate: function() {
          throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
        }, generateInternalStream: function(e2) {
          var t2, r2 = {};
          try {
            if ((r2 = u.extend(e2 || {}, { streamFiles: false, compression: "STORE", compressionOptions: null, type: "", platform: "DOS", comment: null, mimeType: "application/zip", encodeFileName: i.utf8encode })).type = r2.type.toLowerCase(), r2.compression = r2.compression.toUpperCase(), "binarystring" === r2.type && (r2.type = "string"), !r2.type) throw new Error("No output type specified.");
            u.checkSupport(r2.type), "darwin" !== r2.platform && "freebsd" !== r2.platform && "linux" !== r2.platform && "sunos" !== r2.platform || (r2.platform = "UNIX"), "win32" === r2.platform && (r2.platform = "DOS");
            var n2 = r2.comment || this.comment || "";
            t2 = o.generateWorker(this, r2, n2);
          } catch (e3) {
            (t2 = new l("error")).error(e3);
          }
          return new a(t2, r2.type || "string", r2.mimeType);
        }, generateAsync: function(e2, t2) {
          return this.generateInternalStream(e2).accumulate(t2);
        }, generateNodeStream: function(e2, t2) {
          return (e2 = e2 || {}).type || (e2.type = "nodebuffer"), this.generateInternalStream(e2).toNodejsStream(t2);
        } };
        t.exports = n;
      }, { "./compressedObject": 2, "./defaults": 5, "./generate": 9, "./nodejs/NodejsStreamInputAdapter": 12, "./nodejsUtils": 14, "./stream/GenericWorker": 28, "./stream/StreamHelper": 29, "./utf8": 31, "./utils": 32, "./zipObject": 35 }], 16: [function(e, t, r) {
        "use strict";
        t.exports = e("stream");
      }, { stream: void 0 }], 17: [function(e, t, r) {
        "use strict";
        var n = e("./DataReader");
        function i(e2) {
          n.call(this, e2);
          for (var t2 = 0; t2 < this.data.length; t2++) e2[t2] = 255 & e2[t2];
        }
        e("../utils").inherits(i, n), i.prototype.byteAt = function(e2) {
          return this.data[this.zero + e2];
        }, i.prototype.lastIndexOfSignature = function(e2) {
          for (var t2 = e2.charCodeAt(0), r2 = e2.charCodeAt(1), n2 = e2.charCodeAt(2), i2 = e2.charCodeAt(3), s2 = this.length - 4; 0 <= s2; --s2) if (this.data[s2] === t2 && this.data[s2 + 1] === r2 && this.data[s2 + 2] === n2 && this.data[s2 + 3] === i2) return s2 - this.zero;
          return -1;
        }, i.prototype.readAndCheckSignature = function(e2) {
          var t2 = e2.charCodeAt(0), r2 = e2.charCodeAt(1), n2 = e2.charCodeAt(2), i2 = e2.charCodeAt(3), s2 = this.readData(4);
          return t2 === s2[0] && r2 === s2[1] && n2 === s2[2] && i2 === s2[3];
        }, i.prototype.readData = function(e2) {
          if (this.checkOffset(e2), 0 === e2) return [];
          var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
          return this.index += e2, t2;
        }, t.exports = i;
      }, { "../utils": 32, "./DataReader": 18 }], 18: [function(e, t, r) {
        "use strict";
        var n = e("../utils");
        function i(e2) {
          this.data = e2, this.length = e2.length, this.index = 0, this.zero = 0;
        }
        i.prototype = { checkOffset: function(e2) {
          this.checkIndex(this.index + e2);
        }, checkIndex: function(e2) {
          if (this.length < this.zero + e2 || e2 < 0) throw new Error("End of data reached (data length = " + this.length + ", asked index = " + e2 + "). Corrupted zip ?");
        }, setIndex: function(e2) {
          this.checkIndex(e2), this.index = e2;
        }, skip: function(e2) {
          this.setIndex(this.index + e2);
        }, byteAt: function() {
        }, readInt: function(e2) {
          var t2, r2 = 0;
          for (this.checkOffset(e2), t2 = this.index + e2 - 1; t2 >= this.index; t2--) r2 = (r2 << 8) + this.byteAt(t2);
          return this.index += e2, r2;
        }, readString: function(e2) {
          return n.transformTo("string", this.readData(e2));
        }, readData: function() {
        }, lastIndexOfSignature: function() {
        }, readAndCheckSignature: function() {
        }, readDate: function() {
          var e2 = this.readInt(4);
          return new Date(Date.UTC(1980 + (e2 >> 25 & 127), (e2 >> 21 & 15) - 1, e2 >> 16 & 31, e2 >> 11 & 31, e2 >> 5 & 63, (31 & e2) << 1));
        } }, t.exports = i;
      }, { "../utils": 32 }], 19: [function(e, t, r) {
        "use strict";
        var n = e("./Uint8ArrayReader");
        function i(e2) {
          n.call(this, e2);
        }
        e("../utils").inherits(i, n), i.prototype.readData = function(e2) {
          this.checkOffset(e2);
          var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
          return this.index += e2, t2;
        }, t.exports = i;
      }, { "../utils": 32, "./Uint8ArrayReader": 21 }], 20: [function(e, t, r) {
        "use strict";
        var n = e("./DataReader");
        function i(e2) {
          n.call(this, e2);
        }
        e("../utils").inherits(i, n), i.prototype.byteAt = function(e2) {
          return this.data.charCodeAt(this.zero + e2);
        }, i.prototype.lastIndexOfSignature = function(e2) {
          return this.data.lastIndexOf(e2) - this.zero;
        }, i.prototype.readAndCheckSignature = function(e2) {
          return e2 === this.readData(4);
        }, i.prototype.readData = function(e2) {
          this.checkOffset(e2);
          var t2 = this.data.slice(this.zero + this.index, this.zero + this.index + e2);
          return this.index += e2, t2;
        }, t.exports = i;
      }, { "../utils": 32, "./DataReader": 18 }], 21: [function(e, t, r) {
        "use strict";
        var n = e("./ArrayReader");
        function i(e2) {
          n.call(this, e2);
        }
        e("../utils").inherits(i, n), i.prototype.readData = function(e2) {
          if (this.checkOffset(e2), 0 === e2) return new Uint8Array(0);
          var t2 = this.data.subarray(this.zero + this.index, this.zero + this.index + e2);
          return this.index += e2, t2;
        }, t.exports = i;
      }, { "../utils": 32, "./ArrayReader": 17 }], 22: [function(e, t, r) {
        "use strict";
        var n = e("../utils"), i = e("../support"), s2 = e("./ArrayReader"), a = e("./StringReader"), o = e("./NodeBufferReader"), h = e("./Uint8ArrayReader");
        t.exports = function(e2) {
          var t2 = n.getTypeOf(e2);
          return n.checkSupport(t2), "string" !== t2 || i.uint8array ? "nodebuffer" === t2 ? new o(e2) : i.uint8array ? new h(n.transformTo("uint8array", e2)) : new s2(n.transformTo("array", e2)) : new a(e2);
        };
      }, { "../support": 30, "../utils": 32, "./ArrayReader": 17, "./NodeBufferReader": 19, "./StringReader": 20, "./Uint8ArrayReader": 21 }], 23: [function(e, t, r) {
        "use strict";
        r.LOCAL_FILE_HEADER = "PK", r.CENTRAL_FILE_HEADER = "PK", r.CENTRAL_DIRECTORY_END = "PK", r.ZIP64_CENTRAL_DIRECTORY_LOCATOR = "PK\x07", r.ZIP64_CENTRAL_DIRECTORY_END = "PK", r.DATA_DESCRIPTOR = "PK\x07\b";
      }, {}], 24: [function(e, t, r) {
        "use strict";
        var n = e("./GenericWorker"), i = e("../utils");
        function s2(e2) {
          n.call(this, "ConvertWorker to " + e2), this.destType = e2;
        }
        i.inherits(s2, n), s2.prototype.processChunk = function(e2) {
          this.push({ data: i.transformTo(this.destType, e2.data), meta: e2.meta });
        }, t.exports = s2;
      }, { "../utils": 32, "./GenericWorker": 28 }], 25: [function(e, t, r) {
        "use strict";
        var n = e("./GenericWorker"), i = e("../crc32");
        function s2() {
          n.call(this, "Crc32Probe"), this.withStreamInfo("crc32", 0);
        }
        e("../utils").inherits(s2, n), s2.prototype.processChunk = function(e2) {
          this.streamInfo.crc32 = i(e2.data, this.streamInfo.crc32 || 0), this.push(e2);
        }, t.exports = s2;
      }, { "../crc32": 4, "../utils": 32, "./GenericWorker": 28 }], 26: [function(e, t, r) {
        "use strict";
        var n = e("../utils"), i = e("./GenericWorker");
        function s2(e2) {
          i.call(this, "DataLengthProbe for " + e2), this.propName = e2, this.withStreamInfo(e2, 0);
        }
        n.inherits(s2, i), s2.prototype.processChunk = function(e2) {
          if (e2) {
            var t2 = this.streamInfo[this.propName] || 0;
            this.streamInfo[this.propName] = t2 + e2.data.length;
          }
          i.prototype.processChunk.call(this, e2);
        }, t.exports = s2;
      }, { "../utils": 32, "./GenericWorker": 28 }], 27: [function(e, t, r) {
        "use strict";
        var n = e("../utils"), i = e("./GenericWorker");
        function s2(e2) {
          i.call(this, "DataWorker");
          var t2 = this;
          this.dataIsReady = false, this.index = 0, this.max = 0, this.data = null, this.type = "", this._tickScheduled = false, e2.then(function(e3) {
            t2.dataIsReady = true, t2.data = e3, t2.max = e3 && e3.length || 0, t2.type = n.getTypeOf(e3), t2.isPaused || t2._tickAndRepeat();
          }, function(e3) {
            t2.error(e3);
          });
        }
        n.inherits(s2, i), s2.prototype.cleanUp = function() {
          i.prototype.cleanUp.call(this), this.data = null;
        }, s2.prototype.resume = function() {
          return !!i.prototype.resume.call(this) && (!this._tickScheduled && this.dataIsReady && (this._tickScheduled = true, n.delay(this._tickAndRepeat, [], this)), true);
        }, s2.prototype._tickAndRepeat = function() {
          this._tickScheduled = false, this.isPaused || this.isFinished || (this._tick(), this.isFinished || (n.delay(this._tickAndRepeat, [], this), this._tickScheduled = true));
        }, s2.prototype._tick = function() {
          if (this.isPaused || this.isFinished) return false;
          var e2 = null, t2 = Math.min(this.max, this.index + 16384);
          if (this.index >= this.max) return this.end();
          switch (this.type) {
            case "string":
              e2 = this.data.substring(this.index, t2);
              break;
            case "uint8array":
              e2 = this.data.subarray(this.index, t2);
              break;
            case "array":
            case "nodebuffer":
              e2 = this.data.slice(this.index, t2);
          }
          return this.index = t2, this.push({ data: e2, meta: { percent: this.max ? this.index / this.max * 100 : 0 } });
        }, t.exports = s2;
      }, { "../utils": 32, "./GenericWorker": 28 }], 28: [function(e, t, r) {
        "use strict";
        function n(e2) {
          this.name = e2 || "default", this.streamInfo = {}, this.generatedError = null, this.extraStreamInfo = {}, this.isPaused = true, this.isFinished = false, this.isLocked = false, this._listeners = { data: [], end: [], error: [] }, this.previous = null;
        }
        n.prototype = { push: function(e2) {
          this.emit("data", e2);
        }, end: function() {
          if (this.isFinished) return false;
          this.flush();
          try {
            this.emit("end"), this.cleanUp(), this.isFinished = true;
          } catch (e2) {
            this.emit("error", e2);
          }
          return true;
        }, error: function(e2) {
          return !this.isFinished && (this.isPaused ? this.generatedError = e2 : (this.isFinished = true, this.emit("error", e2), this.previous && this.previous.error(e2), this.cleanUp()), true);
        }, on: function(e2, t2) {
          return this._listeners[e2].push(t2), this;
        }, cleanUp: function() {
          this.streamInfo = this.generatedError = this.extraStreamInfo = null, this._listeners = [];
        }, emit: function(e2, t2) {
          if (this._listeners[e2]) for (var r2 = 0; r2 < this._listeners[e2].length; r2++) this._listeners[e2][r2].call(this, t2);
        }, pipe: function(e2) {
          return e2.registerPrevious(this);
        }, registerPrevious: function(e2) {
          if (this.isLocked) throw new Error("The stream '" + this + "' has already been used.");
          this.streamInfo = e2.streamInfo, this.mergeStreamInfo(), this.previous = e2;
          var t2 = this;
          return e2.on("data", function(e3) {
            t2.processChunk(e3);
          }), e2.on("end", function() {
            t2.end();
          }), e2.on("error", function(e3) {
            t2.error(e3);
          }), this;
        }, pause: function() {
          return !this.isPaused && !this.isFinished && (this.isPaused = true, this.previous && this.previous.pause(), true);
        }, resume: function() {
          if (!this.isPaused || this.isFinished) return false;
          var e2 = this.isPaused = false;
          return this.generatedError && (this.error(this.generatedError), e2 = true), this.previous && this.previous.resume(), !e2;
        }, flush: function() {
        }, processChunk: function(e2) {
          this.push(e2);
        }, withStreamInfo: function(e2, t2) {
          return this.extraStreamInfo[e2] = t2, this.mergeStreamInfo(), this;
        }, mergeStreamInfo: function() {
          for (var e2 in this.extraStreamInfo) Object.prototype.hasOwnProperty.call(this.extraStreamInfo, e2) && (this.streamInfo[e2] = this.extraStreamInfo[e2]);
        }, lock: function() {
          if (this.isLocked) throw new Error("The stream '" + this + "' has already been used.");
          this.isLocked = true, this.previous && this.previous.lock();
        }, toString: function() {
          var e2 = "Worker " + this.name;
          return this.previous ? this.previous + " -> " + e2 : e2;
        } }, t.exports = n;
      }, {}], 29: [function(e, t, r) {
        "use strict";
        var h = e("../utils"), i = e("./ConvertWorker"), s2 = e("./GenericWorker"), u = e("../base64"), n = e("../support"), a = e("../external"), o = null;
        if (n.nodestream) try {
          o = e("../nodejs/NodejsStreamOutputAdapter");
        } catch (e2) {
        }
        function l(e2, o2) {
          return new a.Promise(function(t2, r2) {
            var n2 = [], i2 = e2._internalType, s3 = e2._outputType, a2 = e2._mimeType;
            e2.on("data", function(e3, t3) {
              n2.push(e3), o2 && o2(t3);
            }).on("error", function(e3) {
              n2 = [], r2(e3);
            }).on("end", function() {
              try {
                var e3 = (function(e4, t3, r3) {
                  switch (e4) {
                    case "blob":
                      return h.newBlob(h.transformTo("arraybuffer", t3), r3);
                    case "base64":
                      return u.encode(t3);
                    default:
                      return h.transformTo(e4, t3);
                  }
                })(s3, (function(e4, t3) {
                  var r3, n3 = 0, i3 = null, s4 = 0;
                  for (r3 = 0; r3 < t3.length; r3++) s4 += t3[r3].length;
                  switch (e4) {
                    case "string":
                      return t3.join("");
                    case "array":
                      return Array.prototype.concat.apply([], t3);
                    case "uint8array":
                      for (i3 = new Uint8Array(s4), r3 = 0; r3 < t3.length; r3++) i3.set(t3[r3], n3), n3 += t3[r3].length;
                      return i3;
                    case "nodebuffer":
                      return Buffer.concat(t3);
                    default:
                      throw new Error("concat : unsupported type '" + e4 + "'");
                  }
                })(i2, n2), a2);
                t2(e3);
              } catch (e4) {
                r2(e4);
              }
              n2 = [];
            }).resume();
          });
        }
        function f(e2, t2, r2) {
          var n2 = t2;
          switch (t2) {
            case "blob":
            case "arraybuffer":
              n2 = "uint8array";
              break;
            case "base64":
              n2 = "string";
          }
          try {
            this._internalType = n2, this._outputType = t2, this._mimeType = r2, h.checkSupport(n2), this._worker = e2.pipe(new i(n2)), e2.lock();
          } catch (e3) {
            this._worker = new s2("error"), this._worker.error(e3);
          }
        }
        f.prototype = { accumulate: function(e2) {
          return l(this, e2);
        }, on: function(e2, t2) {
          var r2 = this;
          return "data" === e2 ? this._worker.on(e2, function(e3) {
            t2.call(r2, e3.data, e3.meta);
          }) : this._worker.on(e2, function() {
            h.delay(t2, arguments, r2);
          }), this;
        }, resume: function() {
          return h.delay(this._worker.resume, [], this._worker), this;
        }, pause: function() {
          return this._worker.pause(), this;
        }, toNodejsStream: function(e2) {
          if (h.checkSupport("nodestream"), "nodebuffer" !== this._outputType) throw new Error(this._outputType + " is not supported by this method");
          return new o(this, { objectMode: "nodebuffer" !== this._outputType }, e2);
        } }, t.exports = f;
      }, { "../base64": 1, "../external": 6, "../nodejs/NodejsStreamOutputAdapter": 13, "../support": 30, "../utils": 32, "./ConvertWorker": 24, "./GenericWorker": 28 }], 30: [function(e, t, r) {
        "use strict";
        if (r.base64 = true, r.array = true, r.string = true, r.arraybuffer = "undefined" != typeof ArrayBuffer && "undefined" != typeof Uint8Array, r.nodebuffer = "undefined" != typeof Buffer, r.uint8array = "undefined" != typeof Uint8Array, "undefined" == typeof ArrayBuffer) r.blob = false;
        else {
          var n = new ArrayBuffer(0);
          try {
            r.blob = 0 === new Blob([n], { type: "application/zip" }).size;
          } catch (e2) {
            try {
              var i = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
              i.append(n), r.blob = 0 === i.getBlob("application/zip").size;
            } catch (e3) {
              r.blob = false;
            }
          }
        }
        try {
          r.nodestream = !!e("readable-stream").Readable;
        } catch (e2) {
          r.nodestream = false;
        }
      }, { "readable-stream": 16 }], 31: [function(e, t, s2) {
        "use strict";
        for (var o = e("./utils"), h = e("./support"), r = e("./nodejsUtils"), n = e("./stream/GenericWorker"), u = new Array(256), i = 0; i < 256; i++) u[i] = 252 <= i ? 6 : 248 <= i ? 5 : 240 <= i ? 4 : 224 <= i ? 3 : 192 <= i ? 2 : 1;
        u[254] = u[254] = 1;
        function a() {
          n.call(this, "utf-8 decode"), this.leftOver = null;
        }
        function l() {
          n.call(this, "utf-8 encode");
        }
        s2.utf8encode = function(e2) {
          return h.nodebuffer ? r.newBufferFrom(e2, "utf-8") : (function(e3) {
            var t2, r2, n2, i2, s3, a2 = e3.length, o2 = 0;
            for (i2 = 0; i2 < a2; i2++) 55296 == (64512 & (r2 = e3.charCodeAt(i2))) && i2 + 1 < a2 && 56320 == (64512 & (n2 = e3.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), o2 += r2 < 128 ? 1 : r2 < 2048 ? 2 : r2 < 65536 ? 3 : 4;
            for (t2 = h.uint8array ? new Uint8Array(o2) : new Array(o2), i2 = s3 = 0; s3 < o2; i2++) 55296 == (64512 & (r2 = e3.charCodeAt(i2))) && i2 + 1 < a2 && 56320 == (64512 & (n2 = e3.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), r2 < 128 ? t2[s3++] = r2 : (r2 < 2048 ? t2[s3++] = 192 | r2 >>> 6 : (r2 < 65536 ? t2[s3++] = 224 | r2 >>> 12 : (t2[s3++] = 240 | r2 >>> 18, t2[s3++] = 128 | r2 >>> 12 & 63), t2[s3++] = 128 | r2 >>> 6 & 63), t2[s3++] = 128 | 63 & r2);
            return t2;
          })(e2);
        }, s2.utf8decode = function(e2) {
          return h.nodebuffer ? o.transformTo("nodebuffer", e2).toString("utf-8") : (function(e3) {
            var t2, r2, n2, i2, s3 = e3.length, a2 = new Array(2 * s3);
            for (t2 = r2 = 0; t2 < s3; ) if ((n2 = e3[t2++]) < 128) a2[r2++] = n2;
            else if (4 < (i2 = u[n2])) a2[r2++] = 65533, t2 += i2 - 1;
            else {
              for (n2 &= 2 === i2 ? 31 : 3 === i2 ? 15 : 7; 1 < i2 && t2 < s3; ) n2 = n2 << 6 | 63 & e3[t2++], i2--;
              1 < i2 ? a2[r2++] = 65533 : n2 < 65536 ? a2[r2++] = n2 : (n2 -= 65536, a2[r2++] = 55296 | n2 >> 10 & 1023, a2[r2++] = 56320 | 1023 & n2);
            }
            return a2.length !== r2 && (a2.subarray ? a2 = a2.subarray(0, r2) : a2.length = r2), o.applyFromCharCode(a2);
          })(e2 = o.transformTo(h.uint8array ? "uint8array" : "array", e2));
        }, o.inherits(a, n), a.prototype.processChunk = function(e2) {
          var t2 = o.transformTo(h.uint8array ? "uint8array" : "array", e2.data);
          if (this.leftOver && this.leftOver.length) {
            if (h.uint8array) {
              var r2 = t2;
              (t2 = new Uint8Array(r2.length + this.leftOver.length)).set(this.leftOver, 0), t2.set(r2, this.leftOver.length);
            } else t2 = this.leftOver.concat(t2);
            this.leftOver = null;
          }
          var n2 = (function(e3, t3) {
            var r3;
            for ((t3 = t3 || e3.length) > e3.length && (t3 = e3.length), r3 = t3 - 1; 0 <= r3 && 128 == (192 & e3[r3]); ) r3--;
            return r3 < 0 ? t3 : 0 === r3 ? t3 : r3 + u[e3[r3]] > t3 ? r3 : t3;
          })(t2), i2 = t2;
          n2 !== t2.length && (h.uint8array ? (i2 = t2.subarray(0, n2), this.leftOver = t2.subarray(n2, t2.length)) : (i2 = t2.slice(0, n2), this.leftOver = t2.slice(n2, t2.length))), this.push({ data: s2.utf8decode(i2), meta: e2.meta });
        }, a.prototype.flush = function() {
          this.leftOver && this.leftOver.length && (this.push({ data: s2.utf8decode(this.leftOver), meta: {} }), this.leftOver = null);
        }, s2.Utf8DecodeWorker = a, o.inherits(l, n), l.prototype.processChunk = function(e2) {
          this.push({ data: s2.utf8encode(e2.data), meta: e2.meta });
        }, s2.Utf8EncodeWorker = l;
      }, { "./nodejsUtils": 14, "./stream/GenericWorker": 28, "./support": 30, "./utils": 32 }], 32: [function(e, t, a) {
        "use strict";
        var o = e("./support"), h = e("./base64"), r = e("./nodejsUtils"), u = e("./external");
        function n(e2) {
          return e2;
        }
        function l(e2, t2) {
          for (var r2 = 0; r2 < e2.length; ++r2) t2[r2] = 255 & e2.charCodeAt(r2);
          return t2;
        }
        e("setimmediate"), a.newBlob = function(t2, r2) {
          a.checkSupport("blob");
          try {
            return new Blob([t2], { type: r2 });
          } catch (e2) {
            try {
              var n2 = new (self.BlobBuilder || self.WebKitBlobBuilder || self.MozBlobBuilder || self.MSBlobBuilder)();
              return n2.append(t2), n2.getBlob(r2);
            } catch (e3) {
              throw new Error("Bug : can't construct the Blob.");
            }
          }
        };
        var i = { stringifyByChunk: function(e2, t2, r2) {
          var n2 = [], i2 = 0, s3 = e2.length;
          if (s3 <= r2) return String.fromCharCode.apply(null, e2);
          for (; i2 < s3; ) "array" === t2 || "nodebuffer" === t2 ? n2.push(String.fromCharCode.apply(null, e2.slice(i2, Math.min(i2 + r2, s3)))) : n2.push(String.fromCharCode.apply(null, e2.subarray(i2, Math.min(i2 + r2, s3)))), i2 += r2;
          return n2.join("");
        }, stringifyByChar: function(e2) {
          for (var t2 = "", r2 = 0; r2 < e2.length; r2++) t2 += String.fromCharCode(e2[r2]);
          return t2;
        }, applyCanBeUsed: { uint8array: (function() {
          try {
            return o.uint8array && 1 === String.fromCharCode.apply(null, new Uint8Array(1)).length;
          } catch (e2) {
            return false;
          }
        })(), nodebuffer: (function() {
          try {
            return o.nodebuffer && 1 === String.fromCharCode.apply(null, r.allocBuffer(1)).length;
          } catch (e2) {
            return false;
          }
        })() } };
        function s2(e2) {
          var t2 = 65536, r2 = a.getTypeOf(e2), n2 = true;
          if ("uint8array" === r2 ? n2 = i.applyCanBeUsed.uint8array : "nodebuffer" === r2 && (n2 = i.applyCanBeUsed.nodebuffer), n2) for (; 1 < t2; ) try {
            return i.stringifyByChunk(e2, r2, t2);
          } catch (e3) {
            t2 = Math.floor(t2 / 2);
          }
          return i.stringifyByChar(e2);
        }
        function f(e2, t2) {
          for (var r2 = 0; r2 < e2.length; r2++) t2[r2] = e2[r2];
          return t2;
        }
        a.applyFromCharCode = s2;
        var c = {};
        c.string = { string: n, array: function(e2) {
          return l(e2, new Array(e2.length));
        }, arraybuffer: function(e2) {
          return c.string.uint8array(e2).buffer;
        }, uint8array: function(e2) {
          return l(e2, new Uint8Array(e2.length));
        }, nodebuffer: function(e2) {
          return l(e2, r.allocBuffer(e2.length));
        } }, c.array = { string: s2, array: n, arraybuffer: function(e2) {
          return new Uint8Array(e2).buffer;
        }, uint8array: function(e2) {
          return new Uint8Array(e2);
        }, nodebuffer: function(e2) {
          return r.newBufferFrom(e2);
        } }, c.arraybuffer = { string: function(e2) {
          return s2(new Uint8Array(e2));
        }, array: function(e2) {
          return f(new Uint8Array(e2), new Array(e2.byteLength));
        }, arraybuffer: n, uint8array: function(e2) {
          return new Uint8Array(e2);
        }, nodebuffer: function(e2) {
          return r.newBufferFrom(new Uint8Array(e2));
        } }, c.uint8array = { string: s2, array: function(e2) {
          return f(e2, new Array(e2.length));
        }, arraybuffer: function(e2) {
          return e2.buffer;
        }, uint8array: n, nodebuffer: function(e2) {
          return r.newBufferFrom(e2);
        } }, c.nodebuffer = { string: s2, array: function(e2) {
          return f(e2, new Array(e2.length));
        }, arraybuffer: function(e2) {
          return c.nodebuffer.uint8array(e2).buffer;
        }, uint8array: function(e2) {
          return f(e2, new Uint8Array(e2.length));
        }, nodebuffer: n }, a.transformTo = function(e2, t2) {
          if (t2 = t2 || "", !e2) return t2;
          a.checkSupport(e2);
          var r2 = a.getTypeOf(t2);
          return c[r2][e2](t2);
        }, a.resolve = function(e2) {
          for (var t2 = e2.split("/"), r2 = [], n2 = 0; n2 < t2.length; n2++) {
            var i2 = t2[n2];
            "." === i2 || "" === i2 && 0 !== n2 && n2 !== t2.length - 1 || (".." === i2 ? r2.pop() : r2.push(i2));
          }
          return r2.join("/");
        }, a.getTypeOf = function(e2) {
          if ("string" == typeof e2) return "string";
          var t2 = Object.prototype.toString.call(e2);
          return "[object Array]" === t2 ? "array" : o.nodebuffer && r.isBuffer(e2) ? "nodebuffer" : o.uint8array && "[object Uint8Array]" === t2 ? "uint8array" : o.arraybuffer && "[object ArrayBuffer]" === t2 ? "arraybuffer" : void 0;
        }, a.checkSupport = function(e2) {
          if (!o[e2.toLowerCase()]) throw new Error(e2 + " is not supported by this platform");
        }, a.MAX_VALUE_16BITS = 65535, a.MAX_VALUE_32BITS = -1, a.pretty = function(e2) {
          var t2, r2, n2 = "";
          for (r2 = 0; r2 < (e2 || "").length; r2++) n2 += "\\x" + ((t2 = e2.charCodeAt(r2)) < 16 ? "0" : "") + t2.toString(16).toUpperCase();
          return n2;
        }, a.delay = function(e2, t2, r2) {
          setImmediate(function() {
            e2.apply(r2 || null, t2 || []);
          });
        }, a.inherits = function(e2, t2) {
          function r2() {
          }
          r2.prototype = t2.prototype, e2.prototype = new r2();
        }, a.extend = function() {
          var e2, t2, r2 = {};
          for (e2 = 0; e2 < arguments.length; e2++) for (t2 in arguments[e2]) Object.prototype.hasOwnProperty.call(arguments[e2], t2) && void 0 === r2[t2] && (r2[t2] = arguments[e2][t2]);
          return r2;
        }, a.prepareContent = function(r2, e2, n2, i2, s3) {
          return u.Promise.resolve(e2).then(function(n3) {
            return o.blob && (n3 instanceof Blob || -1 !== ["[object File]", "[object Blob]"].indexOf(Object.prototype.toString.call(n3))) ? void 0 !== Blob.prototype.arrayBuffer ? n3.arrayBuffer() : "undefined" != typeof FileReader ? new u.Promise(function(t2, r3) {
              var e3 = new FileReader();
              e3.onload = function(e4) {
                t2(e4.target.result);
              }, e3.onerror = function(e4) {
                r3(e4.target.error);
              }, e3.readAsArrayBuffer(n3);
            }) : u.Promise.reject(new Error(r2 + " is a Blob, but we have no way of reading it.")) : n3;
          }).then(function(e3) {
            var t2 = a.getTypeOf(e3);
            return t2 ? ("arraybuffer" === t2 ? e3 = a.transformTo("uint8array", e3) : "string" === t2 && (s3 ? e3 = h.decode(e3) : n2 && true !== i2 && (e3 = (function(e4) {
              return l(e4, o.uint8array ? new Uint8Array(e4.length) : new Array(e4.length));
            })(e3))), e3) : u.Promise.reject(new Error("Can't read the data of '" + r2 + "'. Is it in a supported JavaScript type (String, Blob, ArrayBuffer, etc) ?"));
          });
        };
      }, { "./base64": 1, "./external": 6, "./nodejsUtils": 14, "./support": 30, setimmediate: 54 }], 33: [function(e, t, r) {
        "use strict";
        var n = e("./reader/readerFor"), i = e("./utils"), s2 = e("./signature"), a = e("./zipEntry"), o = e("./support");
        function h(e2) {
          this.files = [], this.loadOptions = e2;
        }
        h.prototype = { checkSignature: function(e2) {
          if (!this.reader.readAndCheckSignature(e2)) {
            this.reader.index -= 4;
            var t2 = this.reader.readString(4);
            throw new Error("Corrupted zip or bug: unexpected signature (" + i.pretty(t2) + ", expected " + i.pretty(e2) + ")");
          }
        }, isSignature: function(e2, t2) {
          var r2 = this.reader.index;
          this.reader.setIndex(e2);
          var n2 = this.reader.readString(4) === t2;
          return this.reader.setIndex(r2), n2;
        }, readBlockEndOfCentral: function() {
          this.diskNumber = this.reader.readInt(2), this.diskWithCentralDirStart = this.reader.readInt(2), this.centralDirRecordsOnThisDisk = this.reader.readInt(2), this.centralDirRecords = this.reader.readInt(2), this.centralDirSize = this.reader.readInt(4), this.centralDirOffset = this.reader.readInt(4), this.zipCommentLength = this.reader.readInt(2);
          var e2 = this.reader.readData(this.zipCommentLength), t2 = o.uint8array ? "uint8array" : "array", r2 = i.transformTo(t2, e2);
          this.zipComment = this.loadOptions.decodeFileName(r2);
        }, readBlockZip64EndOfCentral: function() {
          this.zip64EndOfCentralSize = this.reader.readInt(8), this.reader.skip(4), this.diskNumber = this.reader.readInt(4), this.diskWithCentralDirStart = this.reader.readInt(4), this.centralDirRecordsOnThisDisk = this.reader.readInt(8), this.centralDirRecords = this.reader.readInt(8), this.centralDirSize = this.reader.readInt(8), this.centralDirOffset = this.reader.readInt(8), this.zip64ExtensibleData = {};
          for (var e2, t2, r2, n2 = this.zip64EndOfCentralSize - 44; 0 < n2; ) e2 = this.reader.readInt(2), t2 = this.reader.readInt(4), r2 = this.reader.readData(t2), this.zip64ExtensibleData[e2] = { id: e2, length: t2, value: r2 };
        }, readBlockZip64EndOfCentralLocator: function() {
          if (this.diskWithZip64CentralDirStart = this.reader.readInt(4), this.relativeOffsetEndOfZip64CentralDir = this.reader.readInt(8), this.disksCount = this.reader.readInt(4), 1 < this.disksCount) throw new Error("Multi-volumes zip are not supported");
        }, readLocalFiles: function() {
          var e2, t2;
          for (e2 = 0; e2 < this.files.length; e2++) t2 = this.files[e2], this.reader.setIndex(t2.localHeaderOffset), this.checkSignature(s2.LOCAL_FILE_HEADER), t2.readLocalPart(this.reader), t2.handleUTF8(), t2.processAttributes();
        }, readCentralDir: function() {
          var e2;
          for (this.reader.setIndex(this.centralDirOffset); this.reader.readAndCheckSignature(s2.CENTRAL_FILE_HEADER); ) (e2 = new a({ zip64: this.zip64 }, this.loadOptions)).readCentralPart(this.reader), this.files.push(e2);
          if (this.centralDirRecords !== this.files.length && 0 !== this.centralDirRecords && 0 === this.files.length) throw new Error("Corrupted zip or bug: expected " + this.centralDirRecords + " records in central dir, got " + this.files.length);
        }, readEndOfCentral: function() {
          var e2 = this.reader.lastIndexOfSignature(s2.CENTRAL_DIRECTORY_END);
          if (e2 < 0) throw !this.isSignature(0, s2.LOCAL_FILE_HEADER) ? new Error("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html") : new Error("Corrupted zip: can't find end of central directory");
          this.reader.setIndex(e2);
          var t2 = e2;
          if (this.checkSignature(s2.CENTRAL_DIRECTORY_END), this.readBlockEndOfCentral(), this.diskNumber === i.MAX_VALUE_16BITS || this.diskWithCentralDirStart === i.MAX_VALUE_16BITS || this.centralDirRecordsOnThisDisk === i.MAX_VALUE_16BITS || this.centralDirRecords === i.MAX_VALUE_16BITS || this.centralDirSize === i.MAX_VALUE_32BITS || this.centralDirOffset === i.MAX_VALUE_32BITS) {
            if (this.zip64 = true, (e2 = this.reader.lastIndexOfSignature(s2.ZIP64_CENTRAL_DIRECTORY_LOCATOR)) < 0) throw new Error("Corrupted zip: can't find the ZIP64 end of central directory locator");
            if (this.reader.setIndex(e2), this.checkSignature(s2.ZIP64_CENTRAL_DIRECTORY_LOCATOR), this.readBlockZip64EndOfCentralLocator(), !this.isSignature(this.relativeOffsetEndOfZip64CentralDir, s2.ZIP64_CENTRAL_DIRECTORY_END) && (this.relativeOffsetEndOfZip64CentralDir = this.reader.lastIndexOfSignature(s2.ZIP64_CENTRAL_DIRECTORY_END), this.relativeOffsetEndOfZip64CentralDir < 0)) throw new Error("Corrupted zip: can't find the ZIP64 end of central directory");
            this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir), this.checkSignature(s2.ZIP64_CENTRAL_DIRECTORY_END), this.readBlockZip64EndOfCentral();
          }
          var r2 = this.centralDirOffset + this.centralDirSize;
          this.zip64 && (r2 += 20, r2 += 12 + this.zip64EndOfCentralSize);
          var n2 = t2 - r2;
          if (0 < n2) this.isSignature(t2, s2.CENTRAL_FILE_HEADER) || (this.reader.zero = n2);
          else if (n2 < 0) throw new Error("Corrupted zip: missing " + Math.abs(n2) + " bytes.");
        }, prepareReader: function(e2) {
          this.reader = n(e2);
        }, load: function(e2) {
          this.prepareReader(e2), this.readEndOfCentral(), this.readCentralDir(), this.readLocalFiles();
        } }, t.exports = h;
      }, { "./reader/readerFor": 22, "./signature": 23, "./support": 30, "./utils": 32, "./zipEntry": 34 }], 34: [function(e, t, r) {
        "use strict";
        var n = e("./reader/readerFor"), s2 = e("./utils"), i = e("./compressedObject"), a = e("./crc32"), o = e("./utf8"), h = e("./compressions"), u = e("./support");
        function l(e2, t2) {
          this.options = e2, this.loadOptions = t2;
        }
        l.prototype = { isEncrypted: function() {
          return 1 == (1 & this.bitFlag);
        }, useUTF8: function() {
          return 2048 == (2048 & this.bitFlag);
        }, readLocalPart: function(e2) {
          var t2, r2;
          if (e2.skip(22), this.fileNameLength = e2.readInt(2), r2 = e2.readInt(2), this.fileName = e2.readData(this.fileNameLength), e2.skip(r2), -1 === this.compressedSize || -1 === this.uncompressedSize) throw new Error("Bug or corrupted zip : didn't get enough information from the central directory (compressedSize === -1 || uncompressedSize === -1)");
          if (null === (t2 = (function(e3) {
            for (var t3 in h) if (Object.prototype.hasOwnProperty.call(h, t3) && h[t3].magic === e3) return h[t3];
            return null;
          })(this.compressionMethod))) throw new Error("Corrupted zip : compression " + s2.pretty(this.compressionMethod) + " unknown (inner file : " + s2.transformTo("string", this.fileName) + ")");
          this.decompressed = new i(this.compressedSize, this.uncompressedSize, this.crc32, t2, e2.readData(this.compressedSize));
        }, readCentralPart: function(e2) {
          this.versionMadeBy = e2.readInt(2), e2.skip(2), this.bitFlag = e2.readInt(2), this.compressionMethod = e2.readString(2), this.date = e2.readDate(), this.crc32 = e2.readInt(4), this.compressedSize = e2.readInt(4), this.uncompressedSize = e2.readInt(4);
          var t2 = e2.readInt(2);
          if (this.extraFieldsLength = e2.readInt(2), this.fileCommentLength = e2.readInt(2), this.diskNumberStart = e2.readInt(2), this.internalFileAttributes = e2.readInt(2), this.externalFileAttributes = e2.readInt(4), this.localHeaderOffset = e2.readInt(4), this.isEncrypted()) throw new Error("Encrypted zip are not supported");
          e2.skip(t2), this.readExtraFields(e2), this.parseZIP64ExtraField(e2), this.fileComment = e2.readData(this.fileCommentLength);
        }, processAttributes: function() {
          this.unixPermissions = null, this.dosPermissions = null;
          var e2 = this.versionMadeBy >> 8;
          this.dir = !!(16 & this.externalFileAttributes), 0 == e2 && (this.dosPermissions = 63 & this.externalFileAttributes), 3 == e2 && (this.unixPermissions = this.externalFileAttributes >> 16 & 65535), this.dir || "/" !== this.fileNameStr.slice(-1) || (this.dir = true);
        }, parseZIP64ExtraField: function() {
          if (this.extraFields[1]) {
            var e2 = n(this.extraFields[1].value);
            this.uncompressedSize === s2.MAX_VALUE_32BITS && (this.uncompressedSize = e2.readInt(8)), this.compressedSize === s2.MAX_VALUE_32BITS && (this.compressedSize = e2.readInt(8)), this.localHeaderOffset === s2.MAX_VALUE_32BITS && (this.localHeaderOffset = e2.readInt(8)), this.diskNumberStart === s2.MAX_VALUE_32BITS && (this.diskNumberStart = e2.readInt(4));
          }
        }, readExtraFields: function(e2) {
          var t2, r2, n2, i2 = e2.index + this.extraFieldsLength;
          for (this.extraFields || (this.extraFields = {}); e2.index + 4 < i2; ) t2 = e2.readInt(2), r2 = e2.readInt(2), n2 = e2.readData(r2), this.extraFields[t2] = { id: t2, length: r2, value: n2 };
          e2.setIndex(i2);
        }, handleUTF8: function() {
          var e2 = u.uint8array ? "uint8array" : "array";
          if (this.useUTF8()) this.fileNameStr = o.utf8decode(this.fileName), this.fileCommentStr = o.utf8decode(this.fileComment);
          else {
            var t2 = this.findExtraFieldUnicodePath();
            if (null !== t2) this.fileNameStr = t2;
            else {
              var r2 = s2.transformTo(e2, this.fileName);
              this.fileNameStr = this.loadOptions.decodeFileName(r2);
            }
            var n2 = this.findExtraFieldUnicodeComment();
            if (null !== n2) this.fileCommentStr = n2;
            else {
              var i2 = s2.transformTo(e2, this.fileComment);
              this.fileCommentStr = this.loadOptions.decodeFileName(i2);
            }
          }
        }, findExtraFieldUnicodePath: function() {
          var e2 = this.extraFields[28789];
          if (e2) {
            var t2 = n(e2.value);
            return 1 !== t2.readInt(1) ? null : a(this.fileName) !== t2.readInt(4) ? null : o.utf8decode(t2.readData(e2.length - 5));
          }
          return null;
        }, findExtraFieldUnicodeComment: function() {
          var e2 = this.extraFields[25461];
          if (e2) {
            var t2 = n(e2.value);
            return 1 !== t2.readInt(1) ? null : a(this.fileComment) !== t2.readInt(4) ? null : o.utf8decode(t2.readData(e2.length - 5));
          }
          return null;
        } }, t.exports = l;
      }, { "./compressedObject": 2, "./compressions": 3, "./crc32": 4, "./reader/readerFor": 22, "./support": 30, "./utf8": 31, "./utils": 32 }], 35: [function(e, t, r) {
        "use strict";
        function n(e2, t2, r2) {
          this.name = e2, this.dir = r2.dir, this.date = r2.date, this.comment = r2.comment, this.unixPermissions = r2.unixPermissions, this.dosPermissions = r2.dosPermissions, this._data = t2, this._dataBinary = r2.binary, this.options = { compression: r2.compression, compressionOptions: r2.compressionOptions };
        }
        var s2 = e("./stream/StreamHelper"), i = e("./stream/DataWorker"), a = e("./utf8"), o = e("./compressedObject"), h = e("./stream/GenericWorker");
        n.prototype = { internalStream: function(e2) {
          var t2 = null, r2 = "string";
          try {
            if (!e2) throw new Error("No output type specified.");
            var n2 = "string" === (r2 = e2.toLowerCase()) || "text" === r2;
            "binarystring" !== r2 && "text" !== r2 || (r2 = "string"), t2 = this._decompressWorker();
            var i2 = !this._dataBinary;
            i2 && !n2 && (t2 = t2.pipe(new a.Utf8EncodeWorker())), !i2 && n2 && (t2 = t2.pipe(new a.Utf8DecodeWorker()));
          } catch (e3) {
            (t2 = new h("error")).error(e3);
          }
          return new s2(t2, r2, "");
        }, async: function(e2, t2) {
          return this.internalStream(e2).accumulate(t2);
        }, nodeStream: function(e2, t2) {
          return this.internalStream(e2 || "nodebuffer").toNodejsStream(t2);
        }, _compressWorker: function(e2, t2) {
          if (this._data instanceof o && this._data.compression.magic === e2.magic) return this._data.getCompressedWorker();
          var r2 = this._decompressWorker();
          return this._dataBinary || (r2 = r2.pipe(new a.Utf8EncodeWorker())), o.createWorkerFrom(r2, e2, t2);
        }, _decompressWorker: function() {
          return this._data instanceof o ? this._data.getContentWorker() : this._data instanceof h ? this._data : new i(this._data);
        } };
        for (var u = ["asText", "asBinary", "asNodeBuffer", "asUint8Array", "asArrayBuffer"], l = function() {
          throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.");
        }, f = 0; f < u.length; f++) n.prototype[u[f]] = l;
        t.exports = n;
      }, { "./compressedObject": 2, "./stream/DataWorker": 27, "./stream/GenericWorker": 28, "./stream/StreamHelper": 29, "./utf8": 31 }], 36: [function(e, l, t) {
        (function(t2) {
          "use strict";
          var r, n, e2 = t2.MutationObserver || t2.WebKitMutationObserver;
          if (e2) {
            var i = 0, s2 = new e2(u), a = t2.document.createTextNode("");
            s2.observe(a, { characterData: true }), r = function() {
              a.data = i = ++i % 2;
            };
          } else if (t2.setImmediate || void 0 === t2.MessageChannel) r = "document" in t2 && "onreadystatechange" in t2.document.createElement("script") ? function() {
            var e3 = t2.document.createElement("script");
            e3.onreadystatechange = function() {
              u(), e3.onreadystatechange = null, e3.parentNode.removeChild(e3), e3 = null;
            }, t2.document.documentElement.appendChild(e3);
          } : function() {
            setTimeout(u, 0);
          };
          else {
            var o = new t2.MessageChannel();
            o.port1.onmessage = u, r = function() {
              o.port2.postMessage(0);
            };
          }
          var h = [];
          function u() {
            var e3, t3;
            n = true;
            for (var r2 = h.length; r2; ) {
              for (t3 = h, h = [], e3 = -1; ++e3 < r2; ) t3[e3]();
              r2 = h.length;
            }
            n = false;
          }
          l.exports = function(e3) {
            1 !== h.push(e3) || n || r();
          };
        }).call(this, "undefined" != typeof global ? global : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {});
      }, {}], 37: [function(e, t, r) {
        "use strict";
        var i = e("immediate");
        function u() {
        }
        var l = {}, s2 = ["REJECTED"], a = ["FULFILLED"], n = ["PENDING"];
        function o(e2) {
          if ("function" != typeof e2) throw new TypeError("resolver must be a function");
          this.state = n, this.queue = [], this.outcome = void 0, e2 !== u && d2(this, e2);
        }
        function h(e2, t2, r2) {
          this.promise = e2, "function" == typeof t2 && (this.onFulfilled = t2, this.callFulfilled = this.otherCallFulfilled), "function" == typeof r2 && (this.onRejected = r2, this.callRejected = this.otherCallRejected);
        }
        function f(t2, r2, n2) {
          i(function() {
            var e2;
            try {
              e2 = r2(n2);
            } catch (e3) {
              return l.reject(t2, e3);
            }
            e2 === t2 ? l.reject(t2, new TypeError("Cannot resolve promise with itself")) : l.resolve(t2, e2);
          });
        }
        function c(e2) {
          var t2 = e2 && e2.then;
          if (e2 && ("object" == typeof e2 || "function" == typeof e2) && "function" == typeof t2) return function() {
            t2.apply(e2, arguments);
          };
        }
        function d2(t2, e2) {
          var r2 = false;
          function n2(e3) {
            r2 || (r2 = true, l.reject(t2, e3));
          }
          function i2(e3) {
            r2 || (r2 = true, l.resolve(t2, e3));
          }
          var s3 = p(function() {
            e2(i2, n2);
          });
          "error" === s3.status && n2(s3.value);
        }
        function p(e2, t2) {
          var r2 = {};
          try {
            r2.value = e2(t2), r2.status = "success";
          } catch (e3) {
            r2.status = "error", r2.value = e3;
          }
          return r2;
        }
        (t.exports = o).prototype.finally = function(t2) {
          if ("function" != typeof t2) return this;
          var r2 = this.constructor;
          return this.then(function(e2) {
            return r2.resolve(t2()).then(function() {
              return e2;
            });
          }, function(e2) {
            return r2.resolve(t2()).then(function() {
              throw e2;
            });
          });
        }, o.prototype.catch = function(e2) {
          return this.then(null, e2);
        }, o.prototype.then = function(e2, t2) {
          if ("function" != typeof e2 && this.state === a || "function" != typeof t2 && this.state === s2) return this;
          var r2 = new this.constructor(u);
          this.state !== n ? f(r2, this.state === a ? e2 : t2, this.outcome) : this.queue.push(new h(r2, e2, t2));
          return r2;
        }, h.prototype.callFulfilled = function(e2) {
          l.resolve(this.promise, e2);
        }, h.prototype.otherCallFulfilled = function(e2) {
          f(this.promise, this.onFulfilled, e2);
        }, h.prototype.callRejected = function(e2) {
          l.reject(this.promise, e2);
        }, h.prototype.otherCallRejected = function(e2) {
          f(this.promise, this.onRejected, e2);
        }, l.resolve = function(e2, t2) {
          var r2 = p(c, t2);
          if ("error" === r2.status) return l.reject(e2, r2.value);
          var n2 = r2.value;
          if (n2) d2(e2, n2);
          else {
            e2.state = a, e2.outcome = t2;
            for (var i2 = -1, s3 = e2.queue.length; ++i2 < s3; ) e2.queue[i2].callFulfilled(t2);
          }
          return e2;
        }, l.reject = function(e2, t2) {
          e2.state = s2, e2.outcome = t2;
          for (var r2 = -1, n2 = e2.queue.length; ++r2 < n2; ) e2.queue[r2].callRejected(t2);
          return e2;
        }, o.resolve = function(e2) {
          if (e2 instanceof this) return e2;
          return l.resolve(new this(u), e2);
        }, o.reject = function(e2) {
          var t2 = new this(u);
          return l.reject(t2, e2);
        }, o.all = function(e2) {
          var r2 = this;
          if ("[object Array]" !== Object.prototype.toString.call(e2)) return this.reject(new TypeError("must be an array"));
          var n2 = e2.length, i2 = false;
          if (!n2) return this.resolve([]);
          var s3 = new Array(n2), a2 = 0, t2 = -1, o2 = new this(u);
          for (; ++t2 < n2; ) h2(e2[t2], t2);
          return o2;
          function h2(e3, t3) {
            r2.resolve(e3).then(function(e4) {
              s3[t3] = e4, ++a2 !== n2 || i2 || (i2 = true, l.resolve(o2, s3));
            }, function(e4) {
              i2 || (i2 = true, l.reject(o2, e4));
            });
          }
        }, o.race = function(e2) {
          var t2 = this;
          if ("[object Array]" !== Object.prototype.toString.call(e2)) return this.reject(new TypeError("must be an array"));
          var r2 = e2.length, n2 = false;
          if (!r2) return this.resolve([]);
          var i2 = -1, s3 = new this(u);
          for (; ++i2 < r2; ) a2 = e2[i2], t2.resolve(a2).then(function(e3) {
            n2 || (n2 = true, l.resolve(s3, e3));
          }, function(e3) {
            n2 || (n2 = true, l.reject(s3, e3));
          });
          var a2;
          return s3;
        };
      }, { immediate: 36 }], 38: [function(e, t, r) {
        "use strict";
        var n = {};
        (0, e("./lib/utils/common").assign)(n, e("./lib/deflate"), e("./lib/inflate"), e("./lib/zlib/constants")), t.exports = n;
      }, { "./lib/deflate": 39, "./lib/inflate": 40, "./lib/utils/common": 41, "./lib/zlib/constants": 44 }], 39: [function(e, t, r) {
        "use strict";
        var a = e("./zlib/deflate"), o = e("./utils/common"), h = e("./utils/strings"), i = e("./zlib/messages"), s2 = e("./zlib/zstream"), u = Object.prototype.toString, l = 0, f = -1, c = 0, d2 = 8;
        function p(e2) {
          if (!(this instanceof p)) return new p(e2);
          this.options = o.assign({ level: f, method: d2, chunkSize: 16384, windowBits: 15, memLevel: 8, strategy: c, to: "" }, e2 || {});
          var t2 = this.options;
          t2.raw && 0 < t2.windowBits ? t2.windowBits = -t2.windowBits : t2.gzip && 0 < t2.windowBits && t2.windowBits < 16 && (t2.windowBits += 16), this.err = 0, this.msg = "", this.ended = false, this.chunks = [], this.strm = new s2(), this.strm.avail_out = 0;
          var r2 = a.deflateInit2(this.strm, t2.level, t2.method, t2.windowBits, t2.memLevel, t2.strategy);
          if (r2 !== l) throw new Error(i[r2]);
          if (t2.header && a.deflateSetHeader(this.strm, t2.header), t2.dictionary) {
            var n2;
            if (n2 = "string" == typeof t2.dictionary ? h.string2buf(t2.dictionary) : "[object ArrayBuffer]" === u.call(t2.dictionary) ? new Uint8Array(t2.dictionary) : t2.dictionary, (r2 = a.deflateSetDictionary(this.strm, n2)) !== l) throw new Error(i[r2]);
            this._dict_set = true;
          }
        }
        function n(e2, t2) {
          var r2 = new p(t2);
          if (r2.push(e2, true), r2.err) throw r2.msg || i[r2.err];
          return r2.result;
        }
        p.prototype.push = function(e2, t2) {
          var r2, n2, i2 = this.strm, s3 = this.options.chunkSize;
          if (this.ended) return false;
          n2 = t2 === ~~t2 ? t2 : true === t2 ? 4 : 0, "string" == typeof e2 ? i2.input = h.string2buf(e2) : "[object ArrayBuffer]" === u.call(e2) ? i2.input = new Uint8Array(e2) : i2.input = e2, i2.next_in = 0, i2.avail_in = i2.input.length;
          do {
            if (0 === i2.avail_out && (i2.output = new o.Buf8(s3), i2.next_out = 0, i2.avail_out = s3), 1 !== (r2 = a.deflate(i2, n2)) && r2 !== l) return this.onEnd(r2), !(this.ended = true);
            0 !== i2.avail_out && (0 !== i2.avail_in || 4 !== n2 && 2 !== n2) || ("string" === this.options.to ? this.onData(h.buf2binstring(o.shrinkBuf(i2.output, i2.next_out))) : this.onData(o.shrinkBuf(i2.output, i2.next_out)));
          } while ((0 < i2.avail_in || 0 === i2.avail_out) && 1 !== r2);
          return 4 === n2 ? (r2 = a.deflateEnd(this.strm), this.onEnd(r2), this.ended = true, r2 === l) : 2 !== n2 || (this.onEnd(l), !(i2.avail_out = 0));
        }, p.prototype.onData = function(e2) {
          this.chunks.push(e2);
        }, p.prototype.onEnd = function(e2) {
          e2 === l && ("string" === this.options.to ? this.result = this.chunks.join("") : this.result = o.flattenChunks(this.chunks)), this.chunks = [], this.err = e2, this.msg = this.strm.msg;
        }, r.Deflate = p, r.deflate = n, r.deflateRaw = function(e2, t2) {
          return (t2 = t2 || {}).raw = true, n(e2, t2);
        }, r.gzip = function(e2, t2) {
          return (t2 = t2 || {}).gzip = true, n(e2, t2);
        };
      }, { "./utils/common": 41, "./utils/strings": 42, "./zlib/deflate": 46, "./zlib/messages": 51, "./zlib/zstream": 53 }], 40: [function(e, t, r) {
        "use strict";
        var c = e("./zlib/inflate"), d2 = e("./utils/common"), p = e("./utils/strings"), m = e("./zlib/constants"), n = e("./zlib/messages"), i = e("./zlib/zstream"), s2 = e("./zlib/gzheader"), _ = Object.prototype.toString;
        function a(e2) {
          if (!(this instanceof a)) return new a(e2);
          this.options = d2.assign({ chunkSize: 16384, windowBits: 0, to: "" }, e2 || {});
          var t2 = this.options;
          t2.raw && 0 <= t2.windowBits && t2.windowBits < 16 && (t2.windowBits = -t2.windowBits, 0 === t2.windowBits && (t2.windowBits = -15)), !(0 <= t2.windowBits && t2.windowBits < 16) || e2 && e2.windowBits || (t2.windowBits += 32), 15 < t2.windowBits && t2.windowBits < 48 && 0 == (15 & t2.windowBits) && (t2.windowBits |= 15), this.err = 0, this.msg = "", this.ended = false, this.chunks = [], this.strm = new i(), this.strm.avail_out = 0;
          var r2 = c.inflateInit2(this.strm, t2.windowBits);
          if (r2 !== m.Z_OK) throw new Error(n[r2]);
          this.header = new s2(), c.inflateGetHeader(this.strm, this.header);
        }
        function o(e2, t2) {
          var r2 = new a(t2);
          if (r2.push(e2, true), r2.err) throw r2.msg || n[r2.err];
          return r2.result;
        }
        a.prototype.push = function(e2, t2) {
          var r2, n2, i2, s3, a2, o2, h = this.strm, u = this.options.chunkSize, l = this.options.dictionary, f = false;
          if (this.ended) return false;
          n2 = t2 === ~~t2 ? t2 : true === t2 ? m.Z_FINISH : m.Z_NO_FLUSH, "string" == typeof e2 ? h.input = p.binstring2buf(e2) : "[object ArrayBuffer]" === _.call(e2) ? h.input = new Uint8Array(e2) : h.input = e2, h.next_in = 0, h.avail_in = h.input.length;
          do {
            if (0 === h.avail_out && (h.output = new d2.Buf8(u), h.next_out = 0, h.avail_out = u), (r2 = c.inflate(h, m.Z_NO_FLUSH)) === m.Z_NEED_DICT && l && (o2 = "string" == typeof l ? p.string2buf(l) : "[object ArrayBuffer]" === _.call(l) ? new Uint8Array(l) : l, r2 = c.inflateSetDictionary(this.strm, o2)), r2 === m.Z_BUF_ERROR && true === f && (r2 = m.Z_OK, f = false), r2 !== m.Z_STREAM_END && r2 !== m.Z_OK) return this.onEnd(r2), !(this.ended = true);
            h.next_out && (0 !== h.avail_out && r2 !== m.Z_STREAM_END && (0 !== h.avail_in || n2 !== m.Z_FINISH && n2 !== m.Z_SYNC_FLUSH) || ("string" === this.options.to ? (i2 = p.utf8border(h.output, h.next_out), s3 = h.next_out - i2, a2 = p.buf2string(h.output, i2), h.next_out = s3, h.avail_out = u - s3, s3 && d2.arraySet(h.output, h.output, i2, s3, 0), this.onData(a2)) : this.onData(d2.shrinkBuf(h.output, h.next_out)))), 0 === h.avail_in && 0 === h.avail_out && (f = true);
          } while ((0 < h.avail_in || 0 === h.avail_out) && r2 !== m.Z_STREAM_END);
          return r2 === m.Z_STREAM_END && (n2 = m.Z_FINISH), n2 === m.Z_FINISH ? (r2 = c.inflateEnd(this.strm), this.onEnd(r2), this.ended = true, r2 === m.Z_OK) : n2 !== m.Z_SYNC_FLUSH || (this.onEnd(m.Z_OK), !(h.avail_out = 0));
        }, a.prototype.onData = function(e2) {
          this.chunks.push(e2);
        }, a.prototype.onEnd = function(e2) {
          e2 === m.Z_OK && ("string" === this.options.to ? this.result = this.chunks.join("") : this.result = d2.flattenChunks(this.chunks)), this.chunks = [], this.err = e2, this.msg = this.strm.msg;
        }, r.Inflate = a, r.inflate = o, r.inflateRaw = function(e2, t2) {
          return (t2 = t2 || {}).raw = true, o(e2, t2);
        }, r.ungzip = o;
      }, { "./utils/common": 41, "./utils/strings": 42, "./zlib/constants": 44, "./zlib/gzheader": 47, "./zlib/inflate": 49, "./zlib/messages": 51, "./zlib/zstream": 53 }], 41: [function(e, t, r) {
        "use strict";
        var n = "undefined" != typeof Uint8Array && "undefined" != typeof Uint16Array && "undefined" != typeof Int32Array;
        r.assign = function(e2) {
          for (var t2 = Array.prototype.slice.call(arguments, 1); t2.length; ) {
            var r2 = t2.shift();
            if (r2) {
              if ("object" != typeof r2) throw new TypeError(r2 + "must be non-object");
              for (var n2 in r2) r2.hasOwnProperty(n2) && (e2[n2] = r2[n2]);
            }
          }
          return e2;
        }, r.shrinkBuf = function(e2, t2) {
          return e2.length === t2 ? e2 : e2.subarray ? e2.subarray(0, t2) : (e2.length = t2, e2);
        };
        var i = { arraySet: function(e2, t2, r2, n2, i2) {
          if (t2.subarray && e2.subarray) e2.set(t2.subarray(r2, r2 + n2), i2);
          else for (var s3 = 0; s3 < n2; s3++) e2[i2 + s3] = t2[r2 + s3];
        }, flattenChunks: function(e2) {
          var t2, r2, n2, i2, s3, a;
          for (t2 = n2 = 0, r2 = e2.length; t2 < r2; t2++) n2 += e2[t2].length;
          for (a = new Uint8Array(n2), t2 = i2 = 0, r2 = e2.length; t2 < r2; t2++) s3 = e2[t2], a.set(s3, i2), i2 += s3.length;
          return a;
        } }, s2 = { arraySet: function(e2, t2, r2, n2, i2) {
          for (var s3 = 0; s3 < n2; s3++) e2[i2 + s3] = t2[r2 + s3];
        }, flattenChunks: function(e2) {
          return [].concat.apply([], e2);
        } };
        r.setTyped = function(e2) {
          e2 ? (r.Buf8 = Uint8Array, r.Buf16 = Uint16Array, r.Buf32 = Int32Array, r.assign(r, i)) : (r.Buf8 = Array, r.Buf16 = Array, r.Buf32 = Array, r.assign(r, s2));
        }, r.setTyped(n);
      }, {}], 42: [function(e, t, r) {
        "use strict";
        var h = e("./common"), i = true, s2 = true;
        try {
          String.fromCharCode.apply(null, [0]);
        } catch (e2) {
          i = false;
        }
        try {
          String.fromCharCode.apply(null, new Uint8Array(1));
        } catch (e2) {
          s2 = false;
        }
        for (var u = new h.Buf8(256), n = 0; n < 256; n++) u[n] = 252 <= n ? 6 : 248 <= n ? 5 : 240 <= n ? 4 : 224 <= n ? 3 : 192 <= n ? 2 : 1;
        function l(e2, t2) {
          if (t2 < 65537 && (e2.subarray && s2 || !e2.subarray && i)) return String.fromCharCode.apply(null, h.shrinkBuf(e2, t2));
          for (var r2 = "", n2 = 0; n2 < t2; n2++) r2 += String.fromCharCode(e2[n2]);
          return r2;
        }
        u[254] = u[254] = 1, r.string2buf = function(e2) {
          var t2, r2, n2, i2, s3, a = e2.length, o = 0;
          for (i2 = 0; i2 < a; i2++) 55296 == (64512 & (r2 = e2.charCodeAt(i2))) && i2 + 1 < a && 56320 == (64512 & (n2 = e2.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), o += r2 < 128 ? 1 : r2 < 2048 ? 2 : r2 < 65536 ? 3 : 4;
          for (t2 = new h.Buf8(o), i2 = s3 = 0; s3 < o; i2++) 55296 == (64512 & (r2 = e2.charCodeAt(i2))) && i2 + 1 < a && 56320 == (64512 & (n2 = e2.charCodeAt(i2 + 1))) && (r2 = 65536 + (r2 - 55296 << 10) + (n2 - 56320), i2++), r2 < 128 ? t2[s3++] = r2 : (r2 < 2048 ? t2[s3++] = 192 | r2 >>> 6 : (r2 < 65536 ? t2[s3++] = 224 | r2 >>> 12 : (t2[s3++] = 240 | r2 >>> 18, t2[s3++] = 128 | r2 >>> 12 & 63), t2[s3++] = 128 | r2 >>> 6 & 63), t2[s3++] = 128 | 63 & r2);
          return t2;
        }, r.buf2binstring = function(e2) {
          return l(e2, e2.length);
        }, r.binstring2buf = function(e2) {
          for (var t2 = new h.Buf8(e2.length), r2 = 0, n2 = t2.length; r2 < n2; r2++) t2[r2] = e2.charCodeAt(r2);
          return t2;
        }, r.buf2string = function(e2, t2) {
          var r2, n2, i2, s3, a = t2 || e2.length, o = new Array(2 * a);
          for (r2 = n2 = 0; r2 < a; ) if ((i2 = e2[r2++]) < 128) o[n2++] = i2;
          else if (4 < (s3 = u[i2])) o[n2++] = 65533, r2 += s3 - 1;
          else {
            for (i2 &= 2 === s3 ? 31 : 3 === s3 ? 15 : 7; 1 < s3 && r2 < a; ) i2 = i2 << 6 | 63 & e2[r2++], s3--;
            1 < s3 ? o[n2++] = 65533 : i2 < 65536 ? o[n2++] = i2 : (i2 -= 65536, o[n2++] = 55296 | i2 >> 10 & 1023, o[n2++] = 56320 | 1023 & i2);
          }
          return l(o, n2);
        }, r.utf8border = function(e2, t2) {
          var r2;
          for ((t2 = t2 || e2.length) > e2.length && (t2 = e2.length), r2 = t2 - 1; 0 <= r2 && 128 == (192 & e2[r2]); ) r2--;
          return r2 < 0 ? t2 : 0 === r2 ? t2 : r2 + u[e2[r2]] > t2 ? r2 : t2;
        };
      }, { "./common": 41 }], 43: [function(e, t, r) {
        "use strict";
        t.exports = function(e2, t2, r2, n) {
          for (var i = 65535 & e2 | 0, s2 = e2 >>> 16 & 65535 | 0, a = 0; 0 !== r2; ) {
            for (r2 -= a = 2e3 < r2 ? 2e3 : r2; s2 = s2 + (i = i + t2[n++] | 0) | 0, --a; ) ;
            i %= 65521, s2 %= 65521;
          }
          return i | s2 << 16 | 0;
        };
      }, {}], 44: [function(e, t, r) {
        "use strict";
        t.exports = { Z_NO_FLUSH: 0, Z_PARTIAL_FLUSH: 1, Z_SYNC_FLUSH: 2, Z_FULL_FLUSH: 3, Z_FINISH: 4, Z_BLOCK: 5, Z_TREES: 6, Z_OK: 0, Z_STREAM_END: 1, Z_NEED_DICT: 2, Z_ERRNO: -1, Z_STREAM_ERROR: -2, Z_DATA_ERROR: -3, Z_BUF_ERROR: -5, Z_NO_COMPRESSION: 0, Z_BEST_SPEED: 1, Z_BEST_COMPRESSION: 9, Z_DEFAULT_COMPRESSION: -1, Z_FILTERED: 1, Z_HUFFMAN_ONLY: 2, Z_RLE: 3, Z_FIXED: 4, Z_DEFAULT_STRATEGY: 0, Z_BINARY: 0, Z_TEXT: 1, Z_UNKNOWN: 2, Z_DEFLATED: 8 };
      }, {}], 45: [function(e, t, r) {
        "use strict";
        var o = (function() {
          for (var e2, t2 = [], r2 = 0; r2 < 256; r2++) {
            e2 = r2;
            for (var n = 0; n < 8; n++) e2 = 1 & e2 ? 3988292384 ^ e2 >>> 1 : e2 >>> 1;
            t2[r2] = e2;
          }
          return t2;
        })();
        t.exports = function(e2, t2, r2, n) {
          var i = o, s2 = n + r2;
          e2 ^= -1;
          for (var a = n; a < s2; a++) e2 = e2 >>> 8 ^ i[255 & (e2 ^ t2[a])];
          return -1 ^ e2;
        };
      }, {}], 46: [function(e, t, r) {
        "use strict";
        var h, c = e("../utils/common"), u = e("./trees"), d2 = e("./adler32"), p = e("./crc32"), n = e("./messages"), l = 0, f = 4, m = 0, _ = -2, g = -1, b = 4, i = 2, v2 = 8, y2 = 9, s2 = 286, a = 30, o = 19, w2 = 2 * s2 + 1, k = 15, x = 3, S2 = 258, z2 = S2 + x + 1, C2 = 42, E = 113, A = 1, I2 = 2, O = 3, B = 4;
        function R(e2, t2) {
          return e2.msg = n[t2], t2;
        }
        function T(e2) {
          return (e2 << 1) - (4 < e2 ? 9 : 0);
        }
        function D(e2) {
          for (var t2 = e2.length; 0 <= --t2; ) e2[t2] = 0;
        }
        function F(e2) {
          var t2 = e2.state, r2 = t2.pending;
          r2 > e2.avail_out && (r2 = e2.avail_out), 0 !== r2 && (c.arraySet(e2.output, t2.pending_buf, t2.pending_out, r2, e2.next_out), e2.next_out += r2, t2.pending_out += r2, e2.total_out += r2, e2.avail_out -= r2, t2.pending -= r2, 0 === t2.pending && (t2.pending_out = 0));
        }
        function N2(e2, t2) {
          u._tr_flush_block(e2, 0 <= e2.block_start ? e2.block_start : -1, e2.strstart - e2.block_start, t2), e2.block_start = e2.strstart, F(e2.strm);
        }
        function U2(e2, t2) {
          e2.pending_buf[e2.pending++] = t2;
        }
        function P(e2, t2) {
          e2.pending_buf[e2.pending++] = t2 >>> 8 & 255, e2.pending_buf[e2.pending++] = 255 & t2;
        }
        function L(e2, t2) {
          var r2, n2, i2 = e2.max_chain_length, s3 = e2.strstart, a2 = e2.prev_length, o2 = e2.nice_match, h2 = e2.strstart > e2.w_size - z2 ? e2.strstart - (e2.w_size - z2) : 0, u2 = e2.window, l2 = e2.w_mask, f2 = e2.prev, c2 = e2.strstart + S2, d3 = u2[s3 + a2 - 1], p2 = u2[s3 + a2];
          e2.prev_length >= e2.good_match && (i2 >>= 2), o2 > e2.lookahead && (o2 = e2.lookahead);
          do {
            if (u2[(r2 = t2) + a2] === p2 && u2[r2 + a2 - 1] === d3 && u2[r2] === u2[s3] && u2[++r2] === u2[s3 + 1]) {
              s3 += 2, r2++;
              do {
              } while (u2[++s3] === u2[++r2] && u2[++s3] === u2[++r2] && u2[++s3] === u2[++r2] && u2[++s3] === u2[++r2] && u2[++s3] === u2[++r2] && u2[++s3] === u2[++r2] && u2[++s3] === u2[++r2] && u2[++s3] === u2[++r2] && s3 < c2);
              if (n2 = S2 - (c2 - s3), s3 = c2 - S2, a2 < n2) {
                if (e2.match_start = t2, o2 <= (a2 = n2)) break;
                d3 = u2[s3 + a2 - 1], p2 = u2[s3 + a2];
              }
            }
          } while ((t2 = f2[t2 & l2]) > h2 && 0 != --i2);
          return a2 <= e2.lookahead ? a2 : e2.lookahead;
        }
        function j(e2) {
          var t2, r2, n2, i2, s3, a2, o2, h2, u2, l2, f2 = e2.w_size;
          do {
            if (i2 = e2.window_size - e2.lookahead - e2.strstart, e2.strstart >= f2 + (f2 - z2)) {
              for (c.arraySet(e2.window, e2.window, f2, f2, 0), e2.match_start -= f2, e2.strstart -= f2, e2.block_start -= f2, t2 = r2 = e2.hash_size; n2 = e2.head[--t2], e2.head[t2] = f2 <= n2 ? n2 - f2 : 0, --r2; ) ;
              for (t2 = r2 = f2; n2 = e2.prev[--t2], e2.prev[t2] = f2 <= n2 ? n2 - f2 : 0, --r2; ) ;
              i2 += f2;
            }
            if (0 === e2.strm.avail_in) break;
            if (a2 = e2.strm, o2 = e2.window, h2 = e2.strstart + e2.lookahead, u2 = i2, l2 = void 0, l2 = a2.avail_in, u2 < l2 && (l2 = u2), r2 = 0 === l2 ? 0 : (a2.avail_in -= l2, c.arraySet(o2, a2.input, a2.next_in, l2, h2), 1 === a2.state.wrap ? a2.adler = d2(a2.adler, o2, l2, h2) : 2 === a2.state.wrap && (a2.adler = p(a2.adler, o2, l2, h2)), a2.next_in += l2, a2.total_in += l2, l2), e2.lookahead += r2, e2.lookahead + e2.insert >= x) for (s3 = e2.strstart - e2.insert, e2.ins_h = e2.window[s3], e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[s3 + 1]) & e2.hash_mask; e2.insert && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[s3 + x - 1]) & e2.hash_mask, e2.prev[s3 & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = s3, s3++, e2.insert--, !(e2.lookahead + e2.insert < x)); ) ;
          } while (e2.lookahead < z2 && 0 !== e2.strm.avail_in);
        }
        function Z(e2, t2) {
          for (var r2, n2; ; ) {
            if (e2.lookahead < z2) {
              if (j(e2), e2.lookahead < z2 && t2 === l) return A;
              if (0 === e2.lookahead) break;
            }
            if (r2 = 0, e2.lookahead >= x && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), 0 !== r2 && e2.strstart - r2 <= e2.w_size - z2 && (e2.match_length = L(e2, r2)), e2.match_length >= x) if (n2 = u._tr_tally(e2, e2.strstart - e2.match_start, e2.match_length - x), e2.lookahead -= e2.match_length, e2.match_length <= e2.max_lazy_match && e2.lookahead >= x) {
              for (e2.match_length--; e2.strstart++, e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart, 0 != --e2.match_length; ) ;
              e2.strstart++;
            } else e2.strstart += e2.match_length, e2.match_length = 0, e2.ins_h = e2.window[e2.strstart], e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + 1]) & e2.hash_mask;
            else n2 = u._tr_tally(e2, 0, e2.window[e2.strstart]), e2.lookahead--, e2.strstart++;
            if (n2 && (N2(e2, false), 0 === e2.strm.avail_out)) return A;
          }
          return e2.insert = e2.strstart < x - 1 ? e2.strstart : x - 1, t2 === f ? (N2(e2, true), 0 === e2.strm.avail_out ? O : B) : e2.last_lit && (N2(e2, false), 0 === e2.strm.avail_out) ? A : I2;
        }
        function W3(e2, t2) {
          for (var r2, n2, i2; ; ) {
            if (e2.lookahead < z2) {
              if (j(e2), e2.lookahead < z2 && t2 === l) return A;
              if (0 === e2.lookahead) break;
            }
            if (r2 = 0, e2.lookahead >= x && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), e2.prev_length = e2.match_length, e2.prev_match = e2.match_start, e2.match_length = x - 1, 0 !== r2 && e2.prev_length < e2.max_lazy_match && e2.strstart - r2 <= e2.w_size - z2 && (e2.match_length = L(e2, r2), e2.match_length <= 5 && (1 === e2.strategy || e2.match_length === x && 4096 < e2.strstart - e2.match_start) && (e2.match_length = x - 1)), e2.prev_length >= x && e2.match_length <= e2.prev_length) {
              for (i2 = e2.strstart + e2.lookahead - x, n2 = u._tr_tally(e2, e2.strstart - 1 - e2.prev_match, e2.prev_length - x), e2.lookahead -= e2.prev_length - 1, e2.prev_length -= 2; ++e2.strstart <= i2 && (e2.ins_h = (e2.ins_h << e2.hash_shift ^ e2.window[e2.strstart + x - 1]) & e2.hash_mask, r2 = e2.prev[e2.strstart & e2.w_mask] = e2.head[e2.ins_h], e2.head[e2.ins_h] = e2.strstart), 0 != --e2.prev_length; ) ;
              if (e2.match_available = 0, e2.match_length = x - 1, e2.strstart++, n2 && (N2(e2, false), 0 === e2.strm.avail_out)) return A;
            } else if (e2.match_available) {
              if ((n2 = u._tr_tally(e2, 0, e2.window[e2.strstart - 1])) && N2(e2, false), e2.strstart++, e2.lookahead--, 0 === e2.strm.avail_out) return A;
            } else e2.match_available = 1, e2.strstart++, e2.lookahead--;
          }
          return e2.match_available && (n2 = u._tr_tally(e2, 0, e2.window[e2.strstart - 1]), e2.match_available = 0), e2.insert = e2.strstart < x - 1 ? e2.strstart : x - 1, t2 === f ? (N2(e2, true), 0 === e2.strm.avail_out ? O : B) : e2.last_lit && (N2(e2, false), 0 === e2.strm.avail_out) ? A : I2;
        }
        function M(e2, t2, r2, n2, i2) {
          this.good_length = e2, this.max_lazy = t2, this.nice_length = r2, this.max_chain = n2, this.func = i2;
        }
        function H() {
          this.strm = null, this.status = 0, this.pending_buf = null, this.pending_buf_size = 0, this.pending_out = 0, this.pending = 0, this.wrap = 0, this.gzhead = null, this.gzindex = 0, this.method = v2, this.last_flush = -1, this.w_size = 0, this.w_bits = 0, this.w_mask = 0, this.window = null, this.window_size = 0, this.prev = null, this.head = null, this.ins_h = 0, this.hash_size = 0, this.hash_bits = 0, this.hash_mask = 0, this.hash_shift = 0, this.block_start = 0, this.match_length = 0, this.prev_match = 0, this.match_available = 0, this.strstart = 0, this.match_start = 0, this.lookahead = 0, this.prev_length = 0, this.max_chain_length = 0, this.max_lazy_match = 0, this.level = 0, this.strategy = 0, this.good_match = 0, this.nice_match = 0, this.dyn_ltree = new c.Buf16(2 * w2), this.dyn_dtree = new c.Buf16(2 * (2 * a + 1)), this.bl_tree = new c.Buf16(2 * (2 * o + 1)), D(this.dyn_ltree), D(this.dyn_dtree), D(this.bl_tree), this.l_desc = null, this.d_desc = null, this.bl_desc = null, this.bl_count = new c.Buf16(k + 1), this.heap = new c.Buf16(2 * s2 + 1), D(this.heap), this.heap_len = 0, this.heap_max = 0, this.depth = new c.Buf16(2 * s2 + 1), D(this.depth), this.l_buf = 0, this.lit_bufsize = 0, this.last_lit = 0, this.d_buf = 0, this.opt_len = 0, this.static_len = 0, this.matches = 0, this.insert = 0, this.bi_buf = 0, this.bi_valid = 0;
        }
        function G2(e2) {
          var t2;
          return e2 && e2.state ? (e2.total_in = e2.total_out = 0, e2.data_type = i, (t2 = e2.state).pending = 0, t2.pending_out = 0, t2.wrap < 0 && (t2.wrap = -t2.wrap), t2.status = t2.wrap ? C2 : E, e2.adler = 2 === t2.wrap ? 0 : 1, t2.last_flush = l, u._tr_init(t2), m) : R(e2, _);
        }
        function K3(e2) {
          var t2 = G2(e2);
          return t2 === m && (function(e3) {
            e3.window_size = 2 * e3.w_size, D(e3.head), e3.max_lazy_match = h[e3.level].max_lazy, e3.good_match = h[e3.level].good_length, e3.nice_match = h[e3.level].nice_length, e3.max_chain_length = h[e3.level].max_chain, e3.strstart = 0, e3.block_start = 0, e3.lookahead = 0, e3.insert = 0, e3.match_length = e3.prev_length = x - 1, e3.match_available = 0, e3.ins_h = 0;
          })(e2.state), t2;
        }
        function Y2(e2, t2, r2, n2, i2, s3) {
          if (!e2) return _;
          var a2 = 1;
          if (t2 === g && (t2 = 6), n2 < 0 ? (a2 = 0, n2 = -n2) : 15 < n2 && (a2 = 2, n2 -= 16), i2 < 1 || y2 < i2 || r2 !== v2 || n2 < 8 || 15 < n2 || t2 < 0 || 9 < t2 || s3 < 0 || b < s3) return R(e2, _);
          8 === n2 && (n2 = 9);
          var o2 = new H();
          return (e2.state = o2).strm = e2, o2.wrap = a2, o2.gzhead = null, o2.w_bits = n2, o2.w_size = 1 << o2.w_bits, o2.w_mask = o2.w_size - 1, o2.hash_bits = i2 + 7, o2.hash_size = 1 << o2.hash_bits, o2.hash_mask = o2.hash_size - 1, o2.hash_shift = ~~((o2.hash_bits + x - 1) / x), o2.window = new c.Buf8(2 * o2.w_size), o2.head = new c.Buf16(o2.hash_size), o2.prev = new c.Buf16(o2.w_size), o2.lit_bufsize = 1 << i2 + 6, o2.pending_buf_size = 4 * o2.lit_bufsize, o2.pending_buf = new c.Buf8(o2.pending_buf_size), o2.d_buf = 1 * o2.lit_bufsize, o2.l_buf = 3 * o2.lit_bufsize, o2.level = t2, o2.strategy = s3, o2.method = r2, K3(e2);
        }
        h = [new M(0, 0, 0, 0, function(e2, t2) {
          var r2 = 65535;
          for (r2 > e2.pending_buf_size - 5 && (r2 = e2.pending_buf_size - 5); ; ) {
            if (e2.lookahead <= 1) {
              if (j(e2), 0 === e2.lookahead && t2 === l) return A;
              if (0 === e2.lookahead) break;
            }
            e2.strstart += e2.lookahead, e2.lookahead = 0;
            var n2 = e2.block_start + r2;
            if ((0 === e2.strstart || e2.strstart >= n2) && (e2.lookahead = e2.strstart - n2, e2.strstart = n2, N2(e2, false), 0 === e2.strm.avail_out)) return A;
            if (e2.strstart - e2.block_start >= e2.w_size - z2 && (N2(e2, false), 0 === e2.strm.avail_out)) return A;
          }
          return e2.insert = 0, t2 === f ? (N2(e2, true), 0 === e2.strm.avail_out ? O : B) : (e2.strstart > e2.block_start && (N2(e2, false), e2.strm.avail_out), A);
        }), new M(4, 4, 8, 4, Z), new M(4, 5, 16, 8, Z), new M(4, 6, 32, 32, Z), new M(4, 4, 16, 16, W3), new M(8, 16, 32, 32, W3), new M(8, 16, 128, 128, W3), new M(8, 32, 128, 256, W3), new M(32, 128, 258, 1024, W3), new M(32, 258, 258, 4096, W3)], r.deflateInit = function(e2, t2) {
          return Y2(e2, t2, v2, 15, 8, 0);
        }, r.deflateInit2 = Y2, r.deflateReset = K3, r.deflateResetKeep = G2, r.deflateSetHeader = function(e2, t2) {
          return e2 && e2.state ? 2 !== e2.state.wrap ? _ : (e2.state.gzhead = t2, m) : _;
        }, r.deflate = function(e2, t2) {
          var r2, n2, i2, s3;
          if (!e2 || !e2.state || 5 < t2 || t2 < 0) return e2 ? R(e2, _) : _;
          if (n2 = e2.state, !e2.output || !e2.input && 0 !== e2.avail_in || 666 === n2.status && t2 !== f) return R(e2, 0 === e2.avail_out ? -5 : _);
          if (n2.strm = e2, r2 = n2.last_flush, n2.last_flush = t2, n2.status === C2) if (2 === n2.wrap) e2.adler = 0, U2(n2, 31), U2(n2, 139), U2(n2, 8), n2.gzhead ? (U2(n2, (n2.gzhead.text ? 1 : 0) + (n2.gzhead.hcrc ? 2 : 0) + (n2.gzhead.extra ? 4 : 0) + (n2.gzhead.name ? 8 : 0) + (n2.gzhead.comment ? 16 : 0)), U2(n2, 255 & n2.gzhead.time), U2(n2, n2.gzhead.time >> 8 & 255), U2(n2, n2.gzhead.time >> 16 & 255), U2(n2, n2.gzhead.time >> 24 & 255), U2(n2, 9 === n2.level ? 2 : 2 <= n2.strategy || n2.level < 2 ? 4 : 0), U2(n2, 255 & n2.gzhead.os), n2.gzhead.extra && n2.gzhead.extra.length && (U2(n2, 255 & n2.gzhead.extra.length), U2(n2, n2.gzhead.extra.length >> 8 & 255)), n2.gzhead.hcrc && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending, 0)), n2.gzindex = 0, n2.status = 69) : (U2(n2, 0), U2(n2, 0), U2(n2, 0), U2(n2, 0), U2(n2, 0), U2(n2, 9 === n2.level ? 2 : 2 <= n2.strategy || n2.level < 2 ? 4 : 0), U2(n2, 3), n2.status = E);
          else {
            var a2 = v2 + (n2.w_bits - 8 << 4) << 8;
            a2 |= (2 <= n2.strategy || n2.level < 2 ? 0 : n2.level < 6 ? 1 : 6 === n2.level ? 2 : 3) << 6, 0 !== n2.strstart && (a2 |= 32), a2 += 31 - a2 % 31, n2.status = E, P(n2, a2), 0 !== n2.strstart && (P(n2, e2.adler >>> 16), P(n2, 65535 & e2.adler)), e2.adler = 1;
          }
          if (69 === n2.status) if (n2.gzhead.extra) {
            for (i2 = n2.pending; n2.gzindex < (65535 & n2.gzhead.extra.length) && (n2.pending !== n2.pending_buf_size || (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending !== n2.pending_buf_size)); ) U2(n2, 255 & n2.gzhead.extra[n2.gzindex]), n2.gzindex++;
            n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), n2.gzindex === n2.gzhead.extra.length && (n2.gzindex = 0, n2.status = 73);
          } else n2.status = 73;
          if (73 === n2.status) if (n2.gzhead.name) {
            i2 = n2.pending;
            do {
              if (n2.pending === n2.pending_buf_size && (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending === n2.pending_buf_size)) {
                s3 = 1;
                break;
              }
              s3 = n2.gzindex < n2.gzhead.name.length ? 255 & n2.gzhead.name.charCodeAt(n2.gzindex++) : 0, U2(n2, s3);
            } while (0 !== s3);
            n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), 0 === s3 && (n2.gzindex = 0, n2.status = 91);
          } else n2.status = 91;
          if (91 === n2.status) if (n2.gzhead.comment) {
            i2 = n2.pending;
            do {
              if (n2.pending === n2.pending_buf_size && (n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), F(e2), i2 = n2.pending, n2.pending === n2.pending_buf_size)) {
                s3 = 1;
                break;
              }
              s3 = n2.gzindex < n2.gzhead.comment.length ? 255 & n2.gzhead.comment.charCodeAt(n2.gzindex++) : 0, U2(n2, s3);
            } while (0 !== s3);
            n2.gzhead.hcrc && n2.pending > i2 && (e2.adler = p(e2.adler, n2.pending_buf, n2.pending - i2, i2)), 0 === s3 && (n2.status = 103);
          } else n2.status = 103;
          if (103 === n2.status && (n2.gzhead.hcrc ? (n2.pending + 2 > n2.pending_buf_size && F(e2), n2.pending + 2 <= n2.pending_buf_size && (U2(n2, 255 & e2.adler), U2(n2, e2.adler >> 8 & 255), e2.adler = 0, n2.status = E)) : n2.status = E), 0 !== n2.pending) {
            if (F(e2), 0 === e2.avail_out) return n2.last_flush = -1, m;
          } else if (0 === e2.avail_in && T(t2) <= T(r2) && t2 !== f) return R(e2, -5);
          if (666 === n2.status && 0 !== e2.avail_in) return R(e2, -5);
          if (0 !== e2.avail_in || 0 !== n2.lookahead || t2 !== l && 666 !== n2.status) {
            var o2 = 2 === n2.strategy ? (function(e3, t3) {
              for (var r3; ; ) {
                if (0 === e3.lookahead && (j(e3), 0 === e3.lookahead)) {
                  if (t3 === l) return A;
                  break;
                }
                if (e3.match_length = 0, r3 = u._tr_tally(e3, 0, e3.window[e3.strstart]), e3.lookahead--, e3.strstart++, r3 && (N2(e3, false), 0 === e3.strm.avail_out)) return A;
              }
              return e3.insert = 0, t3 === f ? (N2(e3, true), 0 === e3.strm.avail_out ? O : B) : e3.last_lit && (N2(e3, false), 0 === e3.strm.avail_out) ? A : I2;
            })(n2, t2) : 3 === n2.strategy ? (function(e3, t3) {
              for (var r3, n3, i3, s4, a3 = e3.window; ; ) {
                if (e3.lookahead <= S2) {
                  if (j(e3), e3.lookahead <= S2 && t3 === l) return A;
                  if (0 === e3.lookahead) break;
                }
                if (e3.match_length = 0, e3.lookahead >= x && 0 < e3.strstart && (n3 = a3[i3 = e3.strstart - 1]) === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3]) {
                  s4 = e3.strstart + S2;
                  do {
                  } while (n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && n3 === a3[++i3] && i3 < s4);
                  e3.match_length = S2 - (s4 - i3), e3.match_length > e3.lookahead && (e3.match_length = e3.lookahead);
                }
                if (e3.match_length >= x ? (r3 = u._tr_tally(e3, 1, e3.match_length - x), e3.lookahead -= e3.match_length, e3.strstart += e3.match_length, e3.match_length = 0) : (r3 = u._tr_tally(e3, 0, e3.window[e3.strstart]), e3.lookahead--, e3.strstart++), r3 && (N2(e3, false), 0 === e3.strm.avail_out)) return A;
              }
              return e3.insert = 0, t3 === f ? (N2(e3, true), 0 === e3.strm.avail_out ? O : B) : e3.last_lit && (N2(e3, false), 0 === e3.strm.avail_out) ? A : I2;
            })(n2, t2) : h[n2.level].func(n2, t2);
            if (o2 !== O && o2 !== B || (n2.status = 666), o2 === A || o2 === O) return 0 === e2.avail_out && (n2.last_flush = -1), m;
            if (o2 === I2 && (1 === t2 ? u._tr_align(n2) : 5 !== t2 && (u._tr_stored_block(n2, 0, 0, false), 3 === t2 && (D(n2.head), 0 === n2.lookahead && (n2.strstart = 0, n2.block_start = 0, n2.insert = 0))), F(e2), 0 === e2.avail_out)) return n2.last_flush = -1, m;
          }
          return t2 !== f ? m : n2.wrap <= 0 ? 1 : (2 === n2.wrap ? (U2(n2, 255 & e2.adler), U2(n2, e2.adler >> 8 & 255), U2(n2, e2.adler >> 16 & 255), U2(n2, e2.adler >> 24 & 255), U2(n2, 255 & e2.total_in), U2(n2, e2.total_in >> 8 & 255), U2(n2, e2.total_in >> 16 & 255), U2(n2, e2.total_in >> 24 & 255)) : (P(n2, e2.adler >>> 16), P(n2, 65535 & e2.adler)), F(e2), 0 < n2.wrap && (n2.wrap = -n2.wrap), 0 !== n2.pending ? m : 1);
        }, r.deflateEnd = function(e2) {
          var t2;
          return e2 && e2.state ? (t2 = e2.state.status) !== C2 && 69 !== t2 && 73 !== t2 && 91 !== t2 && 103 !== t2 && t2 !== E && 666 !== t2 ? R(e2, _) : (e2.state = null, t2 === E ? R(e2, -3) : m) : _;
        }, r.deflateSetDictionary = function(e2, t2) {
          var r2, n2, i2, s3, a2, o2, h2, u2, l2 = t2.length;
          if (!e2 || !e2.state) return _;
          if (2 === (s3 = (r2 = e2.state).wrap) || 1 === s3 && r2.status !== C2 || r2.lookahead) return _;
          for (1 === s3 && (e2.adler = d2(e2.adler, t2, l2, 0)), r2.wrap = 0, l2 >= r2.w_size && (0 === s3 && (D(r2.head), r2.strstart = 0, r2.block_start = 0, r2.insert = 0), u2 = new c.Buf8(r2.w_size), c.arraySet(u2, t2, l2 - r2.w_size, r2.w_size, 0), t2 = u2, l2 = r2.w_size), a2 = e2.avail_in, o2 = e2.next_in, h2 = e2.input, e2.avail_in = l2, e2.next_in = 0, e2.input = t2, j(r2); r2.lookahead >= x; ) {
            for (n2 = r2.strstart, i2 = r2.lookahead - (x - 1); r2.ins_h = (r2.ins_h << r2.hash_shift ^ r2.window[n2 + x - 1]) & r2.hash_mask, r2.prev[n2 & r2.w_mask] = r2.head[r2.ins_h], r2.head[r2.ins_h] = n2, n2++, --i2; ) ;
            r2.strstart = n2, r2.lookahead = x - 1, j(r2);
          }
          return r2.strstart += r2.lookahead, r2.block_start = r2.strstart, r2.insert = r2.lookahead, r2.lookahead = 0, r2.match_length = r2.prev_length = x - 1, r2.match_available = 0, e2.next_in = o2, e2.input = h2, e2.avail_in = a2, r2.wrap = s3, m;
        }, r.deflateInfo = "pako deflate (from Nodeca project)";
      }, { "../utils/common": 41, "./adler32": 43, "./crc32": 45, "./messages": 51, "./trees": 52 }], 47: [function(e, t, r) {
        "use strict";
        t.exports = function() {
          this.text = 0, this.time = 0, this.xflags = 0, this.os = 0, this.extra = null, this.extra_len = 0, this.name = "", this.comment = "", this.hcrc = 0, this.done = false;
        };
      }, {}], 48: [function(e, t, r) {
        "use strict";
        t.exports = function(e2, t2) {
          var r2, n, i, s2, a, o, h, u, l, f, c, d2, p, m, _, g, b, v2, y2, w2, k, x, S2, z2, C2;
          r2 = e2.state, n = e2.next_in, z2 = e2.input, i = n + (e2.avail_in - 5), s2 = e2.next_out, C2 = e2.output, a = s2 - (t2 - e2.avail_out), o = s2 + (e2.avail_out - 257), h = r2.dmax, u = r2.wsize, l = r2.whave, f = r2.wnext, c = r2.window, d2 = r2.hold, p = r2.bits, m = r2.lencode, _ = r2.distcode, g = (1 << r2.lenbits) - 1, b = (1 << r2.distbits) - 1;
          e: do {
            p < 15 && (d2 += z2[n++] << p, p += 8, d2 += z2[n++] << p, p += 8), v2 = m[d2 & g];
            t: for (; ; ) {
              if (d2 >>>= y2 = v2 >>> 24, p -= y2, 0 === (y2 = v2 >>> 16 & 255)) C2[s2++] = 65535 & v2;
              else {
                if (!(16 & y2)) {
                  if (0 == (64 & y2)) {
                    v2 = m[(65535 & v2) + (d2 & (1 << y2) - 1)];
                    continue t;
                  }
                  if (32 & y2) {
                    r2.mode = 12;
                    break e;
                  }
                  e2.msg = "invalid literal/length code", r2.mode = 30;
                  break e;
                }
                w2 = 65535 & v2, (y2 &= 15) && (p < y2 && (d2 += z2[n++] << p, p += 8), w2 += d2 & (1 << y2) - 1, d2 >>>= y2, p -= y2), p < 15 && (d2 += z2[n++] << p, p += 8, d2 += z2[n++] << p, p += 8), v2 = _[d2 & b];
                r: for (; ; ) {
                  if (d2 >>>= y2 = v2 >>> 24, p -= y2, !(16 & (y2 = v2 >>> 16 & 255))) {
                    if (0 == (64 & y2)) {
                      v2 = _[(65535 & v2) + (d2 & (1 << y2) - 1)];
                      continue r;
                    }
                    e2.msg = "invalid distance code", r2.mode = 30;
                    break e;
                  }
                  if (k = 65535 & v2, p < (y2 &= 15) && (d2 += z2[n++] << p, (p += 8) < y2 && (d2 += z2[n++] << p, p += 8)), h < (k += d2 & (1 << y2) - 1)) {
                    e2.msg = "invalid distance too far back", r2.mode = 30;
                    break e;
                  }
                  if (d2 >>>= y2, p -= y2, (y2 = s2 - a) < k) {
                    if (l < (y2 = k - y2) && r2.sane) {
                      e2.msg = "invalid distance too far back", r2.mode = 30;
                      break e;
                    }
                    if (S2 = c, (x = 0) === f) {
                      if (x += u - y2, y2 < w2) {
                        for (w2 -= y2; C2[s2++] = c[x++], --y2; ) ;
                        x = s2 - k, S2 = C2;
                      }
                    } else if (f < y2) {
                      if (x += u + f - y2, (y2 -= f) < w2) {
                        for (w2 -= y2; C2[s2++] = c[x++], --y2; ) ;
                        if (x = 0, f < w2) {
                          for (w2 -= y2 = f; C2[s2++] = c[x++], --y2; ) ;
                          x = s2 - k, S2 = C2;
                        }
                      }
                    } else if (x += f - y2, y2 < w2) {
                      for (w2 -= y2; C2[s2++] = c[x++], --y2; ) ;
                      x = s2 - k, S2 = C2;
                    }
                    for (; 2 < w2; ) C2[s2++] = S2[x++], C2[s2++] = S2[x++], C2[s2++] = S2[x++], w2 -= 3;
                    w2 && (C2[s2++] = S2[x++], 1 < w2 && (C2[s2++] = S2[x++]));
                  } else {
                    for (x = s2 - k; C2[s2++] = C2[x++], C2[s2++] = C2[x++], C2[s2++] = C2[x++], 2 < (w2 -= 3); ) ;
                    w2 && (C2[s2++] = C2[x++], 1 < w2 && (C2[s2++] = C2[x++]));
                  }
                  break;
                }
              }
              break;
            }
          } while (n < i && s2 < o);
          n -= w2 = p >> 3, d2 &= (1 << (p -= w2 << 3)) - 1, e2.next_in = n, e2.next_out = s2, e2.avail_in = n < i ? i - n + 5 : 5 - (n - i), e2.avail_out = s2 < o ? o - s2 + 257 : 257 - (s2 - o), r2.hold = d2, r2.bits = p;
        };
      }, {}], 49: [function(e, t, r) {
        "use strict";
        var I2 = e("../utils/common"), O = e("./adler32"), B = e("./crc32"), R = e("./inffast"), T = e("./inftrees"), D = 1, F = 2, N2 = 0, U2 = -2, P = 1, n = 852, i = 592;
        function L(e2) {
          return (e2 >>> 24 & 255) + (e2 >>> 8 & 65280) + ((65280 & e2) << 8) + ((255 & e2) << 24);
        }
        function s2() {
          this.mode = 0, this.last = false, this.wrap = 0, this.havedict = false, this.flags = 0, this.dmax = 0, this.check = 0, this.total = 0, this.head = null, this.wbits = 0, this.wsize = 0, this.whave = 0, this.wnext = 0, this.window = null, this.hold = 0, this.bits = 0, this.length = 0, this.offset = 0, this.extra = 0, this.lencode = null, this.distcode = null, this.lenbits = 0, this.distbits = 0, this.ncode = 0, this.nlen = 0, this.ndist = 0, this.have = 0, this.next = null, this.lens = new I2.Buf16(320), this.work = new I2.Buf16(288), this.lendyn = null, this.distdyn = null, this.sane = 0, this.back = 0, this.was = 0;
        }
        function a(e2) {
          var t2;
          return e2 && e2.state ? (t2 = e2.state, e2.total_in = e2.total_out = t2.total = 0, e2.msg = "", t2.wrap && (e2.adler = 1 & t2.wrap), t2.mode = P, t2.last = 0, t2.havedict = 0, t2.dmax = 32768, t2.head = null, t2.hold = 0, t2.bits = 0, t2.lencode = t2.lendyn = new I2.Buf32(n), t2.distcode = t2.distdyn = new I2.Buf32(i), t2.sane = 1, t2.back = -1, N2) : U2;
        }
        function o(e2) {
          var t2;
          return e2 && e2.state ? ((t2 = e2.state).wsize = 0, t2.whave = 0, t2.wnext = 0, a(e2)) : U2;
        }
        function h(e2, t2) {
          var r2, n2;
          return e2 && e2.state ? (n2 = e2.state, t2 < 0 ? (r2 = 0, t2 = -t2) : (r2 = 1 + (t2 >> 4), t2 < 48 && (t2 &= 15)), t2 && (t2 < 8 || 15 < t2) ? U2 : (null !== n2.window && n2.wbits !== t2 && (n2.window = null), n2.wrap = r2, n2.wbits = t2, o(e2))) : U2;
        }
        function u(e2, t2) {
          var r2, n2;
          return e2 ? (n2 = new s2(), (e2.state = n2).window = null, (r2 = h(e2, t2)) !== N2 && (e2.state = null), r2) : U2;
        }
        var l, f, c = true;
        function j(e2) {
          if (c) {
            var t2;
            for (l = new I2.Buf32(512), f = new I2.Buf32(32), t2 = 0; t2 < 144; ) e2.lens[t2++] = 8;
            for (; t2 < 256; ) e2.lens[t2++] = 9;
            for (; t2 < 280; ) e2.lens[t2++] = 7;
            for (; t2 < 288; ) e2.lens[t2++] = 8;
            for (T(D, e2.lens, 0, 288, l, 0, e2.work, { bits: 9 }), t2 = 0; t2 < 32; ) e2.lens[t2++] = 5;
            T(F, e2.lens, 0, 32, f, 0, e2.work, { bits: 5 }), c = false;
          }
          e2.lencode = l, e2.lenbits = 9, e2.distcode = f, e2.distbits = 5;
        }
        function Z(e2, t2, r2, n2) {
          var i2, s3 = e2.state;
          return null === s3.window && (s3.wsize = 1 << s3.wbits, s3.wnext = 0, s3.whave = 0, s3.window = new I2.Buf8(s3.wsize)), n2 >= s3.wsize ? (I2.arraySet(s3.window, t2, r2 - s3.wsize, s3.wsize, 0), s3.wnext = 0, s3.whave = s3.wsize) : (n2 < (i2 = s3.wsize - s3.wnext) && (i2 = n2), I2.arraySet(s3.window, t2, r2 - n2, i2, s3.wnext), (n2 -= i2) ? (I2.arraySet(s3.window, t2, r2 - n2, n2, 0), s3.wnext = n2, s3.whave = s3.wsize) : (s3.wnext += i2, s3.wnext === s3.wsize && (s3.wnext = 0), s3.whave < s3.wsize && (s3.whave += i2))), 0;
        }
        r.inflateReset = o, r.inflateReset2 = h, r.inflateResetKeep = a, r.inflateInit = function(e2) {
          return u(e2, 15);
        }, r.inflateInit2 = u, r.inflate = function(e2, t2) {
          var r2, n2, i2, s3, a2, o2, h2, u2, l2, f2, c2, d2, p, m, _, g, b, v2, y2, w2, k, x, S2, z2, C2 = 0, E = new I2.Buf8(4), A = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
          if (!e2 || !e2.state || !e2.output || !e2.input && 0 !== e2.avail_in) return U2;
          12 === (r2 = e2.state).mode && (r2.mode = 13), a2 = e2.next_out, i2 = e2.output, h2 = e2.avail_out, s3 = e2.next_in, n2 = e2.input, o2 = e2.avail_in, u2 = r2.hold, l2 = r2.bits, f2 = o2, c2 = h2, x = N2;
          e: for (; ; ) switch (r2.mode) {
            case P:
              if (0 === r2.wrap) {
                r2.mode = 13;
                break;
              }
              for (; l2 < 16; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s3++] << l2, l2 += 8;
              }
              if (2 & r2.wrap && 35615 === u2) {
                E[r2.check = 0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0), l2 = u2 = 0, r2.mode = 2;
                break;
              }
              if (r2.flags = 0, r2.head && (r2.head.done = false), !(1 & r2.wrap) || (((255 & u2) << 8) + (u2 >> 8)) % 31) {
                e2.msg = "incorrect header check", r2.mode = 30;
                break;
              }
              if (8 != (15 & u2)) {
                e2.msg = "unknown compression method", r2.mode = 30;
                break;
              }
              if (l2 -= 4, k = 8 + (15 & (u2 >>>= 4)), 0 === r2.wbits) r2.wbits = k;
              else if (k > r2.wbits) {
                e2.msg = "invalid window size", r2.mode = 30;
                break;
              }
              r2.dmax = 1 << k, e2.adler = r2.check = 1, r2.mode = 512 & u2 ? 10 : 12, l2 = u2 = 0;
              break;
            case 2:
              for (; l2 < 16; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s3++] << l2, l2 += 8;
              }
              if (r2.flags = u2, 8 != (255 & r2.flags)) {
                e2.msg = "unknown compression method", r2.mode = 30;
                break;
              }
              if (57344 & r2.flags) {
                e2.msg = "unknown header flags set", r2.mode = 30;
                break;
              }
              r2.head && (r2.head.text = u2 >> 8 & 1), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0, r2.mode = 3;
            case 3:
              for (; l2 < 32; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s3++] << l2, l2 += 8;
              }
              r2.head && (r2.head.time = u2), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, E[2] = u2 >>> 16 & 255, E[3] = u2 >>> 24 & 255, r2.check = B(r2.check, E, 4, 0)), l2 = u2 = 0, r2.mode = 4;
            case 4:
              for (; l2 < 16; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s3++] << l2, l2 += 8;
              }
              r2.head && (r2.head.xflags = 255 & u2, r2.head.os = u2 >> 8), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0, r2.mode = 5;
            case 5:
              if (1024 & r2.flags) {
                for (; l2 < 16; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s3++] << l2, l2 += 8;
                }
                r2.length = u2, r2.head && (r2.head.extra_len = u2), 512 & r2.flags && (E[0] = 255 & u2, E[1] = u2 >>> 8 & 255, r2.check = B(r2.check, E, 2, 0)), l2 = u2 = 0;
              } else r2.head && (r2.head.extra = null);
              r2.mode = 6;
            case 6:
              if (1024 & r2.flags && (o2 < (d2 = r2.length) && (d2 = o2), d2 && (r2.head && (k = r2.head.extra_len - r2.length, r2.head.extra || (r2.head.extra = new Array(r2.head.extra_len)), I2.arraySet(r2.head.extra, n2, s3, d2, k)), 512 & r2.flags && (r2.check = B(r2.check, n2, d2, s3)), o2 -= d2, s3 += d2, r2.length -= d2), r2.length)) break e;
              r2.length = 0, r2.mode = 7;
            case 7:
              if (2048 & r2.flags) {
                if (0 === o2) break e;
                for (d2 = 0; k = n2[s3 + d2++], r2.head && k && r2.length < 65536 && (r2.head.name += String.fromCharCode(k)), k && d2 < o2; ) ;
                if (512 & r2.flags && (r2.check = B(r2.check, n2, d2, s3)), o2 -= d2, s3 += d2, k) break e;
              } else r2.head && (r2.head.name = null);
              r2.length = 0, r2.mode = 8;
            case 8:
              if (4096 & r2.flags) {
                if (0 === o2) break e;
                for (d2 = 0; k = n2[s3 + d2++], r2.head && k && r2.length < 65536 && (r2.head.comment += String.fromCharCode(k)), k && d2 < o2; ) ;
                if (512 & r2.flags && (r2.check = B(r2.check, n2, d2, s3)), o2 -= d2, s3 += d2, k) break e;
              } else r2.head && (r2.head.comment = null);
              r2.mode = 9;
            case 9:
              if (512 & r2.flags) {
                for (; l2 < 16; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s3++] << l2, l2 += 8;
                }
                if (u2 !== (65535 & r2.check)) {
                  e2.msg = "header crc mismatch", r2.mode = 30;
                  break;
                }
                l2 = u2 = 0;
              }
              r2.head && (r2.head.hcrc = r2.flags >> 9 & 1, r2.head.done = true), e2.adler = r2.check = 0, r2.mode = 12;
              break;
            case 10:
              for (; l2 < 32; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s3++] << l2, l2 += 8;
              }
              e2.adler = r2.check = L(u2), l2 = u2 = 0, r2.mode = 11;
            case 11:
              if (0 === r2.havedict) return e2.next_out = a2, e2.avail_out = h2, e2.next_in = s3, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, 2;
              e2.adler = r2.check = 1, r2.mode = 12;
            case 12:
              if (5 === t2 || 6 === t2) break e;
            case 13:
              if (r2.last) {
                u2 >>>= 7 & l2, l2 -= 7 & l2, r2.mode = 27;
                break;
              }
              for (; l2 < 3; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s3++] << l2, l2 += 8;
              }
              switch (r2.last = 1 & u2, l2 -= 1, 3 & (u2 >>>= 1)) {
                case 0:
                  r2.mode = 14;
                  break;
                case 1:
                  if (j(r2), r2.mode = 20, 6 !== t2) break;
                  u2 >>>= 2, l2 -= 2;
                  break e;
                case 2:
                  r2.mode = 17;
                  break;
                case 3:
                  e2.msg = "invalid block type", r2.mode = 30;
              }
              u2 >>>= 2, l2 -= 2;
              break;
            case 14:
              for (u2 >>>= 7 & l2, l2 -= 7 & l2; l2 < 32; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s3++] << l2, l2 += 8;
              }
              if ((65535 & u2) != (u2 >>> 16 ^ 65535)) {
                e2.msg = "invalid stored block lengths", r2.mode = 30;
                break;
              }
              if (r2.length = 65535 & u2, l2 = u2 = 0, r2.mode = 15, 6 === t2) break e;
            case 15:
              r2.mode = 16;
            case 16:
              if (d2 = r2.length) {
                if (o2 < d2 && (d2 = o2), h2 < d2 && (d2 = h2), 0 === d2) break e;
                I2.arraySet(i2, n2, s3, d2, a2), o2 -= d2, s3 += d2, h2 -= d2, a2 += d2, r2.length -= d2;
                break;
              }
              r2.mode = 12;
              break;
            case 17:
              for (; l2 < 14; ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s3++] << l2, l2 += 8;
              }
              if (r2.nlen = 257 + (31 & u2), u2 >>>= 5, l2 -= 5, r2.ndist = 1 + (31 & u2), u2 >>>= 5, l2 -= 5, r2.ncode = 4 + (15 & u2), u2 >>>= 4, l2 -= 4, 286 < r2.nlen || 30 < r2.ndist) {
                e2.msg = "too many length or distance symbols", r2.mode = 30;
                break;
              }
              r2.have = 0, r2.mode = 18;
            case 18:
              for (; r2.have < r2.ncode; ) {
                for (; l2 < 3; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s3++] << l2, l2 += 8;
                }
                r2.lens[A[r2.have++]] = 7 & u2, u2 >>>= 3, l2 -= 3;
              }
              for (; r2.have < 19; ) r2.lens[A[r2.have++]] = 0;
              if (r2.lencode = r2.lendyn, r2.lenbits = 7, S2 = { bits: r2.lenbits }, x = T(0, r2.lens, 0, 19, r2.lencode, 0, r2.work, S2), r2.lenbits = S2.bits, x) {
                e2.msg = "invalid code lengths set", r2.mode = 30;
                break;
              }
              r2.have = 0, r2.mode = 19;
            case 19:
              for (; r2.have < r2.nlen + r2.ndist; ) {
                for (; g = (C2 = r2.lencode[u2 & (1 << r2.lenbits) - 1]) >>> 16 & 255, b = 65535 & C2, !((_ = C2 >>> 24) <= l2); ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s3++] << l2, l2 += 8;
                }
                if (b < 16) u2 >>>= _, l2 -= _, r2.lens[r2.have++] = b;
                else {
                  if (16 === b) {
                    for (z2 = _ + 2; l2 < z2; ) {
                      if (0 === o2) break e;
                      o2--, u2 += n2[s3++] << l2, l2 += 8;
                    }
                    if (u2 >>>= _, l2 -= _, 0 === r2.have) {
                      e2.msg = "invalid bit length repeat", r2.mode = 30;
                      break;
                    }
                    k = r2.lens[r2.have - 1], d2 = 3 + (3 & u2), u2 >>>= 2, l2 -= 2;
                  } else if (17 === b) {
                    for (z2 = _ + 3; l2 < z2; ) {
                      if (0 === o2) break e;
                      o2--, u2 += n2[s3++] << l2, l2 += 8;
                    }
                    l2 -= _, k = 0, d2 = 3 + (7 & (u2 >>>= _)), u2 >>>= 3, l2 -= 3;
                  } else {
                    for (z2 = _ + 7; l2 < z2; ) {
                      if (0 === o2) break e;
                      o2--, u2 += n2[s3++] << l2, l2 += 8;
                    }
                    l2 -= _, k = 0, d2 = 11 + (127 & (u2 >>>= _)), u2 >>>= 7, l2 -= 7;
                  }
                  if (r2.have + d2 > r2.nlen + r2.ndist) {
                    e2.msg = "invalid bit length repeat", r2.mode = 30;
                    break;
                  }
                  for (; d2--; ) r2.lens[r2.have++] = k;
                }
              }
              if (30 === r2.mode) break;
              if (0 === r2.lens[256]) {
                e2.msg = "invalid code -- missing end-of-block", r2.mode = 30;
                break;
              }
              if (r2.lenbits = 9, S2 = { bits: r2.lenbits }, x = T(D, r2.lens, 0, r2.nlen, r2.lencode, 0, r2.work, S2), r2.lenbits = S2.bits, x) {
                e2.msg = "invalid literal/lengths set", r2.mode = 30;
                break;
              }
              if (r2.distbits = 6, r2.distcode = r2.distdyn, S2 = { bits: r2.distbits }, x = T(F, r2.lens, r2.nlen, r2.ndist, r2.distcode, 0, r2.work, S2), r2.distbits = S2.bits, x) {
                e2.msg = "invalid distances set", r2.mode = 30;
                break;
              }
              if (r2.mode = 20, 6 === t2) break e;
            case 20:
              r2.mode = 21;
            case 21:
              if (6 <= o2 && 258 <= h2) {
                e2.next_out = a2, e2.avail_out = h2, e2.next_in = s3, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, R(e2, c2), a2 = e2.next_out, i2 = e2.output, h2 = e2.avail_out, s3 = e2.next_in, n2 = e2.input, o2 = e2.avail_in, u2 = r2.hold, l2 = r2.bits, 12 === r2.mode && (r2.back = -1);
                break;
              }
              for (r2.back = 0; g = (C2 = r2.lencode[u2 & (1 << r2.lenbits) - 1]) >>> 16 & 255, b = 65535 & C2, !((_ = C2 >>> 24) <= l2); ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s3++] << l2, l2 += 8;
              }
              if (g && 0 == (240 & g)) {
                for (v2 = _, y2 = g, w2 = b; g = (C2 = r2.lencode[w2 + ((u2 & (1 << v2 + y2) - 1) >> v2)]) >>> 16 & 255, b = 65535 & C2, !(v2 + (_ = C2 >>> 24) <= l2); ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s3++] << l2, l2 += 8;
                }
                u2 >>>= v2, l2 -= v2, r2.back += v2;
              }
              if (u2 >>>= _, l2 -= _, r2.back += _, r2.length = b, 0 === g) {
                r2.mode = 26;
                break;
              }
              if (32 & g) {
                r2.back = -1, r2.mode = 12;
                break;
              }
              if (64 & g) {
                e2.msg = "invalid literal/length code", r2.mode = 30;
                break;
              }
              r2.extra = 15 & g, r2.mode = 22;
            case 22:
              if (r2.extra) {
                for (z2 = r2.extra; l2 < z2; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s3++] << l2, l2 += 8;
                }
                r2.length += u2 & (1 << r2.extra) - 1, u2 >>>= r2.extra, l2 -= r2.extra, r2.back += r2.extra;
              }
              r2.was = r2.length, r2.mode = 23;
            case 23:
              for (; g = (C2 = r2.distcode[u2 & (1 << r2.distbits) - 1]) >>> 16 & 255, b = 65535 & C2, !((_ = C2 >>> 24) <= l2); ) {
                if (0 === o2) break e;
                o2--, u2 += n2[s3++] << l2, l2 += 8;
              }
              if (0 == (240 & g)) {
                for (v2 = _, y2 = g, w2 = b; g = (C2 = r2.distcode[w2 + ((u2 & (1 << v2 + y2) - 1) >> v2)]) >>> 16 & 255, b = 65535 & C2, !(v2 + (_ = C2 >>> 24) <= l2); ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s3++] << l2, l2 += 8;
                }
                u2 >>>= v2, l2 -= v2, r2.back += v2;
              }
              if (u2 >>>= _, l2 -= _, r2.back += _, 64 & g) {
                e2.msg = "invalid distance code", r2.mode = 30;
                break;
              }
              r2.offset = b, r2.extra = 15 & g, r2.mode = 24;
            case 24:
              if (r2.extra) {
                for (z2 = r2.extra; l2 < z2; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s3++] << l2, l2 += 8;
                }
                r2.offset += u2 & (1 << r2.extra) - 1, u2 >>>= r2.extra, l2 -= r2.extra, r2.back += r2.extra;
              }
              if (r2.offset > r2.dmax) {
                e2.msg = "invalid distance too far back", r2.mode = 30;
                break;
              }
              r2.mode = 25;
            case 25:
              if (0 === h2) break e;
              if (d2 = c2 - h2, r2.offset > d2) {
                if ((d2 = r2.offset - d2) > r2.whave && r2.sane) {
                  e2.msg = "invalid distance too far back", r2.mode = 30;
                  break;
                }
                p = d2 > r2.wnext ? (d2 -= r2.wnext, r2.wsize - d2) : r2.wnext - d2, d2 > r2.length && (d2 = r2.length), m = r2.window;
              } else m = i2, p = a2 - r2.offset, d2 = r2.length;
              for (h2 < d2 && (d2 = h2), h2 -= d2, r2.length -= d2; i2[a2++] = m[p++], --d2; ) ;
              0 === r2.length && (r2.mode = 21);
              break;
            case 26:
              if (0 === h2) break e;
              i2[a2++] = r2.length, h2--, r2.mode = 21;
              break;
            case 27:
              if (r2.wrap) {
                for (; l2 < 32; ) {
                  if (0 === o2) break e;
                  o2--, u2 |= n2[s3++] << l2, l2 += 8;
                }
                if (c2 -= h2, e2.total_out += c2, r2.total += c2, c2 && (e2.adler = r2.check = r2.flags ? B(r2.check, i2, c2, a2 - c2) : O(r2.check, i2, c2, a2 - c2)), c2 = h2, (r2.flags ? u2 : L(u2)) !== r2.check) {
                  e2.msg = "incorrect data check", r2.mode = 30;
                  break;
                }
                l2 = u2 = 0;
              }
              r2.mode = 28;
            case 28:
              if (r2.wrap && r2.flags) {
                for (; l2 < 32; ) {
                  if (0 === o2) break e;
                  o2--, u2 += n2[s3++] << l2, l2 += 8;
                }
                if (u2 !== (4294967295 & r2.total)) {
                  e2.msg = "incorrect length check", r2.mode = 30;
                  break;
                }
                l2 = u2 = 0;
              }
              r2.mode = 29;
            case 29:
              x = 1;
              break e;
            case 30:
              x = -3;
              break e;
            case 31:
              return -4;
            case 32:
            default:
              return U2;
          }
          return e2.next_out = a2, e2.avail_out = h2, e2.next_in = s3, e2.avail_in = o2, r2.hold = u2, r2.bits = l2, (r2.wsize || c2 !== e2.avail_out && r2.mode < 30 && (r2.mode < 27 || 4 !== t2)) && Z(e2, e2.output, e2.next_out, c2 - e2.avail_out) ? (r2.mode = 31, -4) : (f2 -= e2.avail_in, c2 -= e2.avail_out, e2.total_in += f2, e2.total_out += c2, r2.total += c2, r2.wrap && c2 && (e2.adler = r2.check = r2.flags ? B(r2.check, i2, c2, e2.next_out - c2) : O(r2.check, i2, c2, e2.next_out - c2)), e2.data_type = r2.bits + (r2.last ? 64 : 0) + (12 === r2.mode ? 128 : 0) + (20 === r2.mode || 15 === r2.mode ? 256 : 0), (0 == f2 && 0 === c2 || 4 === t2) && x === N2 && (x = -5), x);
        }, r.inflateEnd = function(e2) {
          if (!e2 || !e2.state) return U2;
          var t2 = e2.state;
          return t2.window && (t2.window = null), e2.state = null, N2;
        }, r.inflateGetHeader = function(e2, t2) {
          var r2;
          return e2 && e2.state ? 0 == (2 & (r2 = e2.state).wrap) ? U2 : ((r2.head = t2).done = false, N2) : U2;
        }, r.inflateSetDictionary = function(e2, t2) {
          var r2, n2 = t2.length;
          return e2 && e2.state ? 0 !== (r2 = e2.state).wrap && 11 !== r2.mode ? U2 : 11 === r2.mode && O(1, t2, n2, 0) !== r2.check ? -3 : Z(e2, t2, n2, n2) ? (r2.mode = 31, -4) : (r2.havedict = 1, N2) : U2;
        }, r.inflateInfo = "pako inflate (from Nodeca project)";
      }, { "../utils/common": 41, "./adler32": 43, "./crc32": 45, "./inffast": 48, "./inftrees": 50 }], 50: [function(e, t, r) {
        "use strict";
        var D = e("../utils/common"), F = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0], N2 = [16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16, 72, 78], U2 = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577, 0, 0], P = [16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25, 26, 26, 27, 27, 28, 28, 29, 29, 64, 64];
        t.exports = function(e2, t2, r2, n, i, s2, a, o) {
          var h, u, l, f, c, d2, p, m, _, g = o.bits, b = 0, v2 = 0, y2 = 0, w2 = 0, k = 0, x = 0, S2 = 0, z2 = 0, C2 = 0, E = 0, A = null, I2 = 0, O = new D.Buf16(16), B = new D.Buf16(16), R = null, T = 0;
          for (b = 0; b <= 15; b++) O[b] = 0;
          for (v2 = 0; v2 < n; v2++) O[t2[r2 + v2]]++;
          for (k = g, w2 = 15; 1 <= w2 && 0 === O[w2]; w2--) ;
          if (w2 < k && (k = w2), 0 === w2) return i[s2++] = 20971520, i[s2++] = 20971520, o.bits = 1, 0;
          for (y2 = 1; y2 < w2 && 0 === O[y2]; y2++) ;
          for (k < y2 && (k = y2), b = z2 = 1; b <= 15; b++) if (z2 <<= 1, (z2 -= O[b]) < 0) return -1;
          if (0 < z2 && (0 === e2 || 1 !== w2)) return -1;
          for (B[1] = 0, b = 1; b < 15; b++) B[b + 1] = B[b] + O[b];
          for (v2 = 0; v2 < n; v2++) 0 !== t2[r2 + v2] && (a[B[t2[r2 + v2]]++] = v2);
          if (d2 = 0 === e2 ? (A = R = a, 19) : 1 === e2 ? (A = F, I2 -= 257, R = N2, T -= 257, 256) : (A = U2, R = P, -1), b = y2, c = s2, S2 = v2 = E = 0, l = -1, f = (C2 = 1 << (x = k)) - 1, 1 === e2 && 852 < C2 || 2 === e2 && 592 < C2) return 1;
          for (; ; ) {
            for (p = b - S2, _ = a[v2] < d2 ? (m = 0, a[v2]) : a[v2] > d2 ? (m = R[T + a[v2]], A[I2 + a[v2]]) : (m = 96, 0), h = 1 << b - S2, y2 = u = 1 << x; i[c + (E >> S2) + (u -= h)] = p << 24 | m << 16 | _ | 0, 0 !== u; ) ;
            for (h = 1 << b - 1; E & h; ) h >>= 1;
            if (0 !== h ? (E &= h - 1, E += h) : E = 0, v2++, 0 == --O[b]) {
              if (b === w2) break;
              b = t2[r2 + a[v2]];
            }
            if (k < b && (E & f) !== l) {
              for (0 === S2 && (S2 = k), c += y2, z2 = 1 << (x = b - S2); x + S2 < w2 && !((z2 -= O[x + S2]) <= 0); ) x++, z2 <<= 1;
              if (C2 += 1 << x, 1 === e2 && 852 < C2 || 2 === e2 && 592 < C2) return 1;
              i[l = E & f] = k << 24 | x << 16 | c - s2 | 0;
            }
          }
          return 0 !== E && (i[c + E] = b - S2 << 24 | 64 << 16 | 0), o.bits = k, 0;
        };
      }, { "../utils/common": 41 }], 51: [function(e, t, r) {
        "use strict";
        t.exports = { 2: "need dictionary", 1: "stream end", 0: "", "-1": "file error", "-2": "stream error", "-3": "data error", "-4": "insufficient memory", "-5": "buffer error", "-6": "incompatible version" };
      }, {}], 52: [function(e, t, r) {
        "use strict";
        var i = e("../utils/common"), o = 0, h = 1;
        function n(e2) {
          for (var t2 = e2.length; 0 <= --t2; ) e2[t2] = 0;
        }
        var s2 = 0, a = 29, u = 256, l = u + 1 + a, f = 30, c = 19, _ = 2 * l + 1, g = 15, d2 = 16, p = 7, m = 256, b = 16, v2 = 17, y2 = 18, w2 = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0], k = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13], x = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 7], S2 = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15], z2 = new Array(2 * (l + 2));
        n(z2);
        var C2 = new Array(2 * f);
        n(C2);
        var E = new Array(512);
        n(E);
        var A = new Array(256);
        n(A);
        var I2 = new Array(a);
        n(I2);
        var O, B, R, T = new Array(f);
        function D(e2, t2, r2, n2, i2) {
          this.static_tree = e2, this.extra_bits = t2, this.extra_base = r2, this.elems = n2, this.max_length = i2, this.has_stree = e2 && e2.length;
        }
        function F(e2, t2) {
          this.dyn_tree = e2, this.max_code = 0, this.stat_desc = t2;
        }
        function N2(e2) {
          return e2 < 256 ? E[e2] : E[256 + (e2 >>> 7)];
        }
        function U2(e2, t2) {
          e2.pending_buf[e2.pending++] = 255 & t2, e2.pending_buf[e2.pending++] = t2 >>> 8 & 255;
        }
        function P(e2, t2, r2) {
          e2.bi_valid > d2 - r2 ? (e2.bi_buf |= t2 << e2.bi_valid & 65535, U2(e2, e2.bi_buf), e2.bi_buf = t2 >> d2 - e2.bi_valid, e2.bi_valid += r2 - d2) : (e2.bi_buf |= t2 << e2.bi_valid & 65535, e2.bi_valid += r2);
        }
        function L(e2, t2, r2) {
          P(e2, r2[2 * t2], r2[2 * t2 + 1]);
        }
        function j(e2, t2) {
          for (var r2 = 0; r2 |= 1 & e2, e2 >>>= 1, r2 <<= 1, 0 < --t2; ) ;
          return r2 >>> 1;
        }
        function Z(e2, t2, r2) {
          var n2, i2, s3 = new Array(g + 1), a2 = 0;
          for (n2 = 1; n2 <= g; n2++) s3[n2] = a2 = a2 + r2[n2 - 1] << 1;
          for (i2 = 0; i2 <= t2; i2++) {
            var o2 = e2[2 * i2 + 1];
            0 !== o2 && (e2[2 * i2] = j(s3[o2]++, o2));
          }
        }
        function W3(e2) {
          var t2;
          for (t2 = 0; t2 < l; t2++) e2.dyn_ltree[2 * t2] = 0;
          for (t2 = 0; t2 < f; t2++) e2.dyn_dtree[2 * t2] = 0;
          for (t2 = 0; t2 < c; t2++) e2.bl_tree[2 * t2] = 0;
          e2.dyn_ltree[2 * m] = 1, e2.opt_len = e2.static_len = 0, e2.last_lit = e2.matches = 0;
        }
        function M(e2) {
          8 < e2.bi_valid ? U2(e2, e2.bi_buf) : 0 < e2.bi_valid && (e2.pending_buf[e2.pending++] = e2.bi_buf), e2.bi_buf = 0, e2.bi_valid = 0;
        }
        function H(e2, t2, r2, n2) {
          var i2 = 2 * t2, s3 = 2 * r2;
          return e2[i2] < e2[s3] || e2[i2] === e2[s3] && n2[t2] <= n2[r2];
        }
        function G2(e2, t2, r2) {
          for (var n2 = e2.heap[r2], i2 = r2 << 1; i2 <= e2.heap_len && (i2 < e2.heap_len && H(t2, e2.heap[i2 + 1], e2.heap[i2], e2.depth) && i2++, !H(t2, n2, e2.heap[i2], e2.depth)); ) e2.heap[r2] = e2.heap[i2], r2 = i2, i2 <<= 1;
          e2.heap[r2] = n2;
        }
        function K3(e2, t2, r2) {
          var n2, i2, s3, a2, o2 = 0;
          if (0 !== e2.last_lit) for (; n2 = e2.pending_buf[e2.d_buf + 2 * o2] << 8 | e2.pending_buf[e2.d_buf + 2 * o2 + 1], i2 = e2.pending_buf[e2.l_buf + o2], o2++, 0 === n2 ? L(e2, i2, t2) : (L(e2, (s3 = A[i2]) + u + 1, t2), 0 !== (a2 = w2[s3]) && P(e2, i2 -= I2[s3], a2), L(e2, s3 = N2(--n2), r2), 0 !== (a2 = k[s3]) && P(e2, n2 -= T[s3], a2)), o2 < e2.last_lit; ) ;
          L(e2, m, t2);
        }
        function Y2(e2, t2) {
          var r2, n2, i2, s3 = t2.dyn_tree, a2 = t2.stat_desc.static_tree, o2 = t2.stat_desc.has_stree, h2 = t2.stat_desc.elems, u2 = -1;
          for (e2.heap_len = 0, e2.heap_max = _, r2 = 0; r2 < h2; r2++) 0 !== s3[2 * r2] ? (e2.heap[++e2.heap_len] = u2 = r2, e2.depth[r2] = 0) : s3[2 * r2 + 1] = 0;
          for (; e2.heap_len < 2; ) s3[2 * (i2 = e2.heap[++e2.heap_len] = u2 < 2 ? ++u2 : 0)] = 1, e2.depth[i2] = 0, e2.opt_len--, o2 && (e2.static_len -= a2[2 * i2 + 1]);
          for (t2.max_code = u2, r2 = e2.heap_len >> 1; 1 <= r2; r2--) G2(e2, s3, r2);
          for (i2 = h2; r2 = e2.heap[1], e2.heap[1] = e2.heap[e2.heap_len--], G2(e2, s3, 1), n2 = e2.heap[1], e2.heap[--e2.heap_max] = r2, e2.heap[--e2.heap_max] = n2, s3[2 * i2] = s3[2 * r2] + s3[2 * n2], e2.depth[i2] = (e2.depth[r2] >= e2.depth[n2] ? e2.depth[r2] : e2.depth[n2]) + 1, s3[2 * r2 + 1] = s3[2 * n2 + 1] = i2, e2.heap[1] = i2++, G2(e2, s3, 1), 2 <= e2.heap_len; ) ;
          e2.heap[--e2.heap_max] = e2.heap[1], (function(e3, t3) {
            var r3, n3, i3, s4, a3, o3, h3 = t3.dyn_tree, u3 = t3.max_code, l2 = t3.stat_desc.static_tree, f2 = t3.stat_desc.has_stree, c2 = t3.stat_desc.extra_bits, d3 = t3.stat_desc.extra_base, p2 = t3.stat_desc.max_length, m2 = 0;
            for (s4 = 0; s4 <= g; s4++) e3.bl_count[s4] = 0;
            for (h3[2 * e3.heap[e3.heap_max] + 1] = 0, r3 = e3.heap_max + 1; r3 < _; r3++) p2 < (s4 = h3[2 * h3[2 * (n3 = e3.heap[r3]) + 1] + 1] + 1) && (s4 = p2, m2++), h3[2 * n3 + 1] = s4, u3 < n3 || (e3.bl_count[s4]++, a3 = 0, d3 <= n3 && (a3 = c2[n3 - d3]), o3 = h3[2 * n3], e3.opt_len += o3 * (s4 + a3), f2 && (e3.static_len += o3 * (l2[2 * n3 + 1] + a3)));
            if (0 !== m2) {
              do {
                for (s4 = p2 - 1; 0 === e3.bl_count[s4]; ) s4--;
                e3.bl_count[s4]--, e3.bl_count[s4 + 1] += 2, e3.bl_count[p2]--, m2 -= 2;
              } while (0 < m2);
              for (s4 = p2; 0 !== s4; s4--) for (n3 = e3.bl_count[s4]; 0 !== n3; ) u3 < (i3 = e3.heap[--r3]) || (h3[2 * i3 + 1] !== s4 && (e3.opt_len += (s4 - h3[2 * i3 + 1]) * h3[2 * i3], h3[2 * i3 + 1] = s4), n3--);
            }
          })(e2, t2), Z(s3, u2, e2.bl_count);
        }
        function X(e2, t2, r2) {
          var n2, i2, s3 = -1, a2 = t2[1], o2 = 0, h2 = 7, u2 = 4;
          for (0 === a2 && (h2 = 138, u2 = 3), t2[2 * (r2 + 1) + 1] = 65535, n2 = 0; n2 <= r2; n2++) i2 = a2, a2 = t2[2 * (n2 + 1) + 1], ++o2 < h2 && i2 === a2 || (o2 < u2 ? e2.bl_tree[2 * i2] += o2 : 0 !== i2 ? (i2 !== s3 && e2.bl_tree[2 * i2]++, e2.bl_tree[2 * b]++) : o2 <= 10 ? e2.bl_tree[2 * v2]++ : e2.bl_tree[2 * y2]++, s3 = i2, u2 = (o2 = 0) === a2 ? (h2 = 138, 3) : i2 === a2 ? (h2 = 6, 3) : (h2 = 7, 4));
        }
        function V3(e2, t2, r2) {
          var n2, i2, s3 = -1, a2 = t2[1], o2 = 0, h2 = 7, u2 = 4;
          for (0 === a2 && (h2 = 138, u2 = 3), n2 = 0; n2 <= r2; n2++) if (i2 = a2, a2 = t2[2 * (n2 + 1) + 1], !(++o2 < h2 && i2 === a2)) {
            if (o2 < u2) for (; L(e2, i2, e2.bl_tree), 0 != --o2; ) ;
            else 0 !== i2 ? (i2 !== s3 && (L(e2, i2, e2.bl_tree), o2--), L(e2, b, e2.bl_tree), P(e2, o2 - 3, 2)) : o2 <= 10 ? (L(e2, v2, e2.bl_tree), P(e2, o2 - 3, 3)) : (L(e2, y2, e2.bl_tree), P(e2, o2 - 11, 7));
            s3 = i2, u2 = (o2 = 0) === a2 ? (h2 = 138, 3) : i2 === a2 ? (h2 = 6, 3) : (h2 = 7, 4);
          }
        }
        n(T);
        var q2 = false;
        function J2(e2, t2, r2, n2) {
          P(e2, (s2 << 1) + (n2 ? 1 : 0), 3), (function(e3, t3, r3, n3) {
            M(e3), n3 && (U2(e3, r3), U2(e3, ~r3)), i.arraySet(e3.pending_buf, e3.window, t3, r3, e3.pending), e3.pending += r3;
          })(e2, t2, r2, true);
        }
        r._tr_init = function(e2) {
          q2 || ((function() {
            var e3, t2, r2, n2, i2, s3 = new Array(g + 1);
            for (n2 = r2 = 0; n2 < a - 1; n2++) for (I2[n2] = r2, e3 = 0; e3 < 1 << w2[n2]; e3++) A[r2++] = n2;
            for (A[r2 - 1] = n2, n2 = i2 = 0; n2 < 16; n2++) for (T[n2] = i2, e3 = 0; e3 < 1 << k[n2]; e3++) E[i2++] = n2;
            for (i2 >>= 7; n2 < f; n2++) for (T[n2] = i2 << 7, e3 = 0; e3 < 1 << k[n2] - 7; e3++) E[256 + i2++] = n2;
            for (t2 = 0; t2 <= g; t2++) s3[t2] = 0;
            for (e3 = 0; e3 <= 143; ) z2[2 * e3 + 1] = 8, e3++, s3[8]++;
            for (; e3 <= 255; ) z2[2 * e3 + 1] = 9, e3++, s3[9]++;
            for (; e3 <= 279; ) z2[2 * e3 + 1] = 7, e3++, s3[7]++;
            for (; e3 <= 287; ) z2[2 * e3 + 1] = 8, e3++, s3[8]++;
            for (Z(z2, l + 1, s3), e3 = 0; e3 < f; e3++) C2[2 * e3 + 1] = 5, C2[2 * e3] = j(e3, 5);
            O = new D(z2, w2, u + 1, l, g), B = new D(C2, k, 0, f, g), R = new D(new Array(0), x, 0, c, p);
          })(), q2 = true), e2.l_desc = new F(e2.dyn_ltree, O), e2.d_desc = new F(e2.dyn_dtree, B), e2.bl_desc = new F(e2.bl_tree, R), e2.bi_buf = 0, e2.bi_valid = 0, W3(e2);
        }, r._tr_stored_block = J2, r._tr_flush_block = function(e2, t2, r2, n2) {
          var i2, s3, a2 = 0;
          0 < e2.level ? (2 === e2.strm.data_type && (e2.strm.data_type = (function(e3) {
            var t3, r3 = 4093624447;
            for (t3 = 0; t3 <= 31; t3++, r3 >>>= 1) if (1 & r3 && 0 !== e3.dyn_ltree[2 * t3]) return o;
            if (0 !== e3.dyn_ltree[18] || 0 !== e3.dyn_ltree[20] || 0 !== e3.dyn_ltree[26]) return h;
            for (t3 = 32; t3 < u; t3++) if (0 !== e3.dyn_ltree[2 * t3]) return h;
            return o;
          })(e2)), Y2(e2, e2.l_desc), Y2(e2, e2.d_desc), a2 = (function(e3) {
            var t3;
            for (X(e3, e3.dyn_ltree, e3.l_desc.max_code), X(e3, e3.dyn_dtree, e3.d_desc.max_code), Y2(e3, e3.bl_desc), t3 = c - 1; 3 <= t3 && 0 === e3.bl_tree[2 * S2[t3] + 1]; t3--) ;
            return e3.opt_len += 3 * (t3 + 1) + 5 + 5 + 4, t3;
          })(e2), i2 = e2.opt_len + 3 + 7 >>> 3, (s3 = e2.static_len + 3 + 7 >>> 3) <= i2 && (i2 = s3)) : i2 = s3 = r2 + 5, r2 + 4 <= i2 && -1 !== t2 ? J2(e2, t2, r2, n2) : 4 === e2.strategy || s3 === i2 ? (P(e2, 2 + (n2 ? 1 : 0), 3), K3(e2, z2, C2)) : (P(e2, 4 + (n2 ? 1 : 0), 3), (function(e3, t3, r3, n3) {
            var i3;
            for (P(e3, t3 - 257, 5), P(e3, r3 - 1, 5), P(e3, n3 - 4, 4), i3 = 0; i3 < n3; i3++) P(e3, e3.bl_tree[2 * S2[i3] + 1], 3);
            V3(e3, e3.dyn_ltree, t3 - 1), V3(e3, e3.dyn_dtree, r3 - 1);
          })(e2, e2.l_desc.max_code + 1, e2.d_desc.max_code + 1, a2 + 1), K3(e2, e2.dyn_ltree, e2.dyn_dtree)), W3(e2), n2 && M(e2);
        }, r._tr_tally = function(e2, t2, r2) {
          return e2.pending_buf[e2.d_buf + 2 * e2.last_lit] = t2 >>> 8 & 255, e2.pending_buf[e2.d_buf + 2 * e2.last_lit + 1] = 255 & t2, e2.pending_buf[e2.l_buf + e2.last_lit] = 255 & r2, e2.last_lit++, 0 === t2 ? e2.dyn_ltree[2 * r2]++ : (e2.matches++, t2--, e2.dyn_ltree[2 * (A[r2] + u + 1)]++, e2.dyn_dtree[2 * N2(t2)]++), e2.last_lit === e2.lit_bufsize - 1;
        }, r._tr_align = function(e2) {
          P(e2, 2, 3), L(e2, m, z2), (function(e3) {
            16 === e3.bi_valid ? (U2(e3, e3.bi_buf), e3.bi_buf = 0, e3.bi_valid = 0) : 8 <= e3.bi_valid && (e3.pending_buf[e3.pending++] = 255 & e3.bi_buf, e3.bi_buf >>= 8, e3.bi_valid -= 8);
          })(e2);
        };
      }, { "../utils/common": 41 }], 53: [function(e, t, r) {
        "use strict";
        t.exports = function() {
          this.input = null, this.next_in = 0, this.avail_in = 0, this.total_in = 0, this.output = null, this.next_out = 0, this.avail_out = 0, this.total_out = 0, this.msg = "", this.state = null, this.data_type = 2, this.adler = 0;
        };
      }, {}], 54: [function(e, t, r) {
        (function(e2) {
          !(function(r2, n) {
            "use strict";
            if (!r2.setImmediate) {
              var i, s2, t2, a, o = 1, h = {}, u = false, l = r2.document, e3 = Object.getPrototypeOf && Object.getPrototypeOf(r2);
              e3 = e3 && e3.setTimeout ? e3 : r2, i = "[object process]" === {}.toString.call(r2.process) ? function(e4) {
                process.nextTick(function() {
                  c(e4);
                });
              } : (function() {
                if (r2.postMessage && !r2.importScripts) {
                  var e4 = true, t3 = r2.onmessage;
                  return r2.onmessage = function() {
                    e4 = false;
                  }, r2.postMessage("", "*"), r2.onmessage = t3, e4;
                }
              })() ? (a = "setImmediate$" + Math.random() + "$", r2.addEventListener ? r2.addEventListener("message", d2, false) : r2.attachEvent("onmessage", d2), function(e4) {
                r2.postMessage(a + e4, "*");
              }) : r2.MessageChannel ? ((t2 = new MessageChannel()).port1.onmessage = function(e4) {
                c(e4.data);
              }, function(e4) {
                t2.port2.postMessage(e4);
              }) : l && "onreadystatechange" in l.createElement("script") ? (s2 = l.documentElement, function(e4) {
                var t3 = l.createElement("script");
                t3.onreadystatechange = function() {
                  c(e4), t3.onreadystatechange = null, s2.removeChild(t3), t3 = null;
                }, s2.appendChild(t3);
              }) : function(e4) {
                setTimeout(c, 0, e4);
              }, e3.setImmediate = function(e4) {
                "function" != typeof e4 && (e4 = new Function("" + e4));
                for (var t3 = new Array(arguments.length - 1), r3 = 0; r3 < t3.length; r3++) t3[r3] = arguments[r3 + 1];
                var n2 = { callback: e4, args: t3 };
                return h[o] = n2, i(o), o++;
              }, e3.clearImmediate = f;
            }
            function f(e4) {
              delete h[e4];
            }
            function c(e4) {
              if (u) setTimeout(c, 0, e4);
              else {
                var t3 = h[e4];
                if (t3) {
                  u = true;
                  try {
                    !(function(e5) {
                      var t4 = e5.callback, r3 = e5.args;
                      switch (r3.length) {
                        case 0:
                          t4();
                          break;
                        case 1:
                          t4(r3[0]);
                          break;
                        case 2:
                          t4(r3[0], r3[1]);
                          break;
                        case 3:
                          t4(r3[0], r3[1], r3[2]);
                          break;
                        default:
                          t4.apply(n, r3);
                      }
                    })(t3);
                  } finally {
                    f(e4), u = false;
                  }
                }
              }
            }
            function d2(e4) {
              e4.source === r2 && "string" == typeof e4.data && 0 === e4.data.indexOf(a) && c(+e4.data.slice(a.length));
            }
          })("undefined" == typeof self ? void 0 === e2 ? this : e2 : self);
        }).call(this, "undefined" != typeof global ? global : "undefined" != typeof self ? self : "undefined" != typeof window ? window : {});
      }, {}] }, {}, [10])(10);
    });
  }
});

// node_modules/fast-xml-parser/src/util.js
var nameStartChar = ":A-Za-z_\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD";
var nameChar = nameStartChar + "\\-.\\d\\u00B7\\u0300-\\u036F\\u203F-\\u2040";
var nameRegexp = "[" + nameStartChar + "][" + nameChar + "]*";
var regexName = new RegExp("^" + nameRegexp + "$");
function getAllMatches(string, regex) {
  const matches = [];
  let match = regex.exec(string);
  while (match) {
    const allmatches = [];
    allmatches.startIndex = regex.lastIndex - match[0].length;
    const len = match.length;
    for (let index = 0; index < len; index++) {
      allmatches.push(match[index]);
    }
    matches.push(allmatches);
    match = regex.exec(string);
  }
  return matches;
}
var isName = function(string) {
  const match = regexName.exec(string);
  return !(match === null || typeof match === "undefined");
};
function isExist(v2) {
  return typeof v2 !== "undefined";
}
var DANGEROUS_PROPERTY_NAMES = [
  // '__proto__',
  // 'constructor',
  // 'prototype',
  "hasOwnProperty",
  "toString",
  "valueOf",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__"
];
var criticalProperties = ["__proto__", "constructor", "prototype"];

// node_modules/fast-xml-parser/src/validator.js
var defaultOptions = {
  allowBooleanAttributes: false,
  //A tag can have attributes without any value
  unpairedTags: []
};
function validate(xmlData, options) {
  options = Object.assign({}, defaultOptions, options);
  const tags = [];
  let tagFound = false;
  let reachedRoot = false;
  if (xmlData[0] === "\uFEFF") {
    xmlData = xmlData.substr(1);
  }
  for (let i = 0; i < xmlData.length; i++) {
    if (xmlData[i] === "<" && xmlData[i + 1] === "?") {
      i += 2;
      i = readPI(xmlData, i);
      if (i.err) return i;
    } else if (xmlData[i] === "<") {
      let tagStartPos = i;
      i++;
      if (xmlData[i] === "!") {
        i = readCommentAndCDATA(xmlData, i);
        continue;
      } else {
        let closingTag = false;
        if (xmlData[i] === "/") {
          closingTag = true;
          i++;
        }
        let tagName = "";
        for (; i < xmlData.length && xmlData[i] !== ">" && xmlData[i] !== " " && xmlData[i] !== "	" && xmlData[i] !== "\n" && xmlData[i] !== "\r"; i++) {
          tagName += xmlData[i];
        }
        tagName = tagName.trim();
        if (tagName[tagName.length - 1] === "/") {
          tagName = tagName.substring(0, tagName.length - 1);
          i--;
        }
        if (!validateTagName(tagName)) {
          let msg;
          if (tagName.trim().length === 0) {
            msg = "Invalid space after '<'.";
          } else {
            msg = "Tag '" + tagName + "' is an invalid name.";
          }
          return getErrorObject("InvalidTag", msg, getLineNumberForPosition(xmlData, i));
        }
        const result = readAttributeStr(xmlData, i);
        if (result === false) {
          return getErrorObject("InvalidAttr", "Attributes for '" + tagName + "' have open quote.", getLineNumberForPosition(xmlData, i));
        }
        let attrStr = result.value;
        i = result.index;
        if (attrStr[attrStr.length - 1] === "/") {
          const attrStrStart = i - attrStr.length;
          attrStr = attrStr.substring(0, attrStr.length - 1);
          const isValid = validateAttributeString(attrStr, options);
          if (isValid === true) {
            tagFound = true;
          } else {
            return getErrorObject(isValid.err.code, isValid.err.msg, getLineNumberForPosition(xmlData, attrStrStart + isValid.err.line));
          }
        } else if (closingTag) {
          if (!result.tagClosed) {
            return getErrorObject("InvalidTag", "Closing tag '" + tagName + "' doesn't have proper closing.", getLineNumberForPosition(xmlData, i));
          } else if (attrStr.trim().length > 0) {
            return getErrorObject("InvalidTag", "Closing tag '" + tagName + "' can't have attributes or invalid starting.", getLineNumberForPosition(xmlData, tagStartPos));
          } else if (tags.length === 0) {
            return getErrorObject("InvalidTag", "Closing tag '" + tagName + "' has not been opened.", getLineNumberForPosition(xmlData, tagStartPos));
          } else {
            const otg = tags.pop();
            if (tagName !== otg.tagName) {
              let openPos = getLineNumberForPosition(xmlData, otg.tagStartPos);
              return getErrorObject(
                "InvalidTag",
                "Expected closing tag '" + otg.tagName + "' (opened in line " + openPos.line + ", col " + openPos.col + ") instead of closing tag '" + tagName + "'.",
                getLineNumberForPosition(xmlData, tagStartPos)
              );
            }
            if (tags.length == 0) {
              reachedRoot = true;
            }
          }
        } else {
          const isValid = validateAttributeString(attrStr, options);
          if (isValid !== true) {
            return getErrorObject(isValid.err.code, isValid.err.msg, getLineNumberForPosition(xmlData, i - attrStr.length + isValid.err.line));
          }
          if (reachedRoot === true) {
            return getErrorObject("InvalidXml", "Multiple possible root nodes found.", getLineNumberForPosition(xmlData, i));
          } else if (options.unpairedTags.indexOf(tagName) !== -1) {
          } else {
            tags.push({ tagName, tagStartPos });
          }
          tagFound = true;
        }
        for (i++; i < xmlData.length; i++) {
          if (xmlData[i] === "<") {
            if (xmlData[i + 1] === "!") {
              i++;
              i = readCommentAndCDATA(xmlData, i);
              continue;
            } else if (xmlData[i + 1] === "?") {
              i = readPI(xmlData, ++i);
              if (i.err) return i;
            } else {
              break;
            }
          } else if (xmlData[i] === "&") {
            const afterAmp = validateAmpersand(xmlData, i);
            if (afterAmp == -1)
              return getErrorObject("InvalidChar", "char '&' is not expected.", getLineNumberForPosition(xmlData, i));
            i = afterAmp;
          } else {
            if (reachedRoot === true && !isWhiteSpace(xmlData[i])) {
              return getErrorObject("InvalidXml", "Extra text at the end", getLineNumberForPosition(xmlData, i));
            }
          }
        }
        if (xmlData[i] === "<") {
          i--;
        }
      }
    } else {
      if (isWhiteSpace(xmlData[i])) {
        continue;
      }
      return getErrorObject("InvalidChar", "char '" + xmlData[i] + "' is not expected.", getLineNumberForPosition(xmlData, i));
    }
  }
  if (!tagFound) {
    return getErrorObject("InvalidXml", "Start tag expected.", 1);
  } else if (tags.length == 1) {
    return getErrorObject("InvalidTag", "Unclosed tag '" + tags[0].tagName + "'.", getLineNumberForPosition(xmlData, tags[0].tagStartPos));
  } else if (tags.length > 0) {
    return getErrorObject("InvalidXml", "Invalid '" + JSON.stringify(tags.map((t) => t.tagName), null, 4).replace(/\r?\n/g, "") + "' found.", { line: 1, col: 1 });
  }
  return true;
}
function isWhiteSpace(char) {
  return char === " " || char === "	" || char === "\n" || char === "\r";
}
function readPI(xmlData, i) {
  const start = i;
  for (; i < xmlData.length; i++) {
    if (xmlData[i] == "?" || xmlData[i] == " ") {
      const tagname = xmlData.substr(start, i - start);
      if (i > 5 && tagname === "xml") {
        return getErrorObject("InvalidXml", "XML declaration allowed only at the start of the document.", getLineNumberForPosition(xmlData, i));
      } else if (xmlData[i] == "?" && xmlData[i + 1] == ">") {
        i++;
        break;
      } else {
        continue;
      }
    }
  }
  return i;
}
function readCommentAndCDATA(xmlData, i) {
  if (xmlData.length > i + 5 && xmlData[i + 1] === "-" && xmlData[i + 2] === "-") {
    for (i += 3; i < xmlData.length; i++) {
      if (xmlData[i] === "-" && xmlData[i + 1] === "-" && xmlData[i + 2] === ">") {
        i += 2;
        break;
      }
    }
  } else if (xmlData.length > i + 8 && xmlData[i + 1] === "D" && xmlData[i + 2] === "O" && xmlData[i + 3] === "C" && xmlData[i + 4] === "T" && xmlData[i + 5] === "Y" && xmlData[i + 6] === "P" && xmlData[i + 7] === "E") {
    let angleBracketsCount = 1;
    for (i += 8; i < xmlData.length; i++) {
      if (xmlData[i] === "<") {
        angleBracketsCount++;
      } else if (xmlData[i] === ">") {
        angleBracketsCount--;
        if (angleBracketsCount === 0) {
          break;
        }
      }
    }
  } else if (xmlData.length > i + 9 && xmlData[i + 1] === "[" && xmlData[i + 2] === "C" && xmlData[i + 3] === "D" && xmlData[i + 4] === "A" && xmlData[i + 5] === "T" && xmlData[i + 6] === "A" && xmlData[i + 7] === "[") {
    for (i += 8; i < xmlData.length; i++) {
      if (xmlData[i] === "]" && xmlData[i + 1] === "]" && xmlData[i + 2] === ">") {
        i += 2;
        break;
      }
    }
  }
  return i;
}
var doubleQuote = '"';
var singleQuote = "'";
function readAttributeStr(xmlData, i) {
  let attrStr = "";
  let startChar = "";
  let tagClosed = false;
  for (; i < xmlData.length; i++) {
    if (xmlData[i] === doubleQuote || xmlData[i] === singleQuote) {
      if (startChar === "") {
        startChar = xmlData[i];
      } else if (startChar !== xmlData[i]) {
      } else {
        startChar = "";
      }
    } else if (xmlData[i] === ">") {
      if (startChar === "") {
        tagClosed = true;
        break;
      }
    }
    attrStr += xmlData[i];
  }
  if (startChar !== "") {
    return false;
  }
  return {
    value: attrStr,
    index: i,
    tagClosed
  };
}
function scanAttributeTokens(attrStr) {
  const tokens = [];
  const len = attrStr.length;
  let i = 0;
  while (i < len) {
    const tokenStart = i;
    while (i < len && isWhiteSpace(attrStr[i])) i++;
    if (i >= len) break;
    if (attrStr[i] === "=") {
      i++;
      continue;
    }
    const leadingWs = attrStr.slice(tokenStart, i);
    const nameStart = i;
    while (i < len && !isWhiteSpace(attrStr[i]) && attrStr[i] !== "=") i++;
    const name = attrStr.slice(nameStart, i);
    let equalsGroup;
    let j = i;
    while (j < len && isWhiteSpace(attrStr[j])) j++;
    if (j < len && attrStr[j] === "=") {
      equalsGroup = attrStr.slice(i, j + 1);
      i = j + 1;
    }
    let quoteChar;
    let value;
    let k = i;
    while (k < len && isWhiteSpace(attrStr[k])) k++;
    if (k < len && (attrStr[k] === '"' || attrStr[k] === "'")) {
      const valueStart = k + 1;
      const closeIdx = attrStr.indexOf(attrStr[k], valueStart);
      if (closeIdx !== -1) {
        quoteChar = attrStr[k];
        value = attrStr.slice(valueStart, closeIdx);
        i = closeIdx + 1;
      }
    }
    const token = { startIndex: tokenStart };
    token[1] = leadingWs;
    token[2] = name;
    token[3] = equalsGroup;
    token[4] = quoteChar !== void 0 ? true : void 0;
    token[5] = quoteChar;
    token[6] = value;
    tokens.push(token);
  }
  return tokens;
}
function validateAttributeString(attrStr, options) {
  const matches = scanAttributeTokens(attrStr);
  const attrNames = {};
  for (let i = 0; i < matches.length; i++) {
    if (matches[i][1].length === 0) {
      return getErrorObject("InvalidAttr", "Attribute '" + matches[i][2] + "' has no space in starting.", getPositionFromMatch(matches[i]));
    } else if (matches[i][3] !== void 0 && matches[i][4] === void 0) {
      return getErrorObject("InvalidAttr", "Attribute '" + matches[i][2] + "' is without value.", getPositionFromMatch(matches[i]));
    } else if (matches[i][3] === void 0 && !options.allowBooleanAttributes) {
      return getErrorObject("InvalidAttr", "boolean attribute '" + matches[i][2] + "' is not allowed.", getPositionFromMatch(matches[i]));
    }
    const attrName = matches[i][2];
    if (!validateAttrName(attrName)) {
      return getErrorObject("InvalidAttr", "Attribute '" + attrName + "' is an invalid name.", getPositionFromMatch(matches[i]));
    }
    if (!Object.prototype.hasOwnProperty.call(attrNames, attrName)) {
      attrNames[attrName] = 1;
    } else {
      return getErrorObject("InvalidAttr", "Attribute '" + attrName + "' is repeated.", getPositionFromMatch(matches[i]));
    }
  }
  return true;
}
function validateNumberAmpersand(xmlData, i) {
  let re3 = /\d/;
  if (xmlData[i] === "x") {
    i++;
    re3 = /[\da-fA-F]/;
  }
  for (; i < xmlData.length; i++) {
    if (xmlData[i] === ";")
      return i;
    if (!xmlData[i].match(re3))
      break;
  }
  return -1;
}
function validateAmpersand(xmlData, i) {
  i++;
  if (xmlData[i] === ";")
    return -1;
  if (xmlData[i] === "#") {
    i++;
    return validateNumberAmpersand(xmlData, i);
  }
  let count = 0;
  for (; i < xmlData.length; i++, count++) {
    if (xmlData[i].match(/\w/) && count < 20)
      continue;
    if (xmlData[i] === ";")
      break;
    return -1;
  }
  return i;
}
function getErrorObject(code, message, lineNumber) {
  return {
    err: {
      code,
      msg: message,
      line: lineNumber.line || lineNumber,
      col: lineNumber.col
    }
  };
}
function validateAttrName(attrName) {
  return isName(attrName);
}
function validateTagName(tagname) {
  return isName(tagname);
}
function getLineNumberForPosition(xmlData, index) {
  const lines = xmlData.substring(0, index).split(/\r?\n/);
  return {
    line: lines.length,
    // column number is last line's length + 1, because column numbering starts at 1:
    col: lines[lines.length - 1].length + 1
  };
}
function getPositionFromMatch(match) {
  return match.startIndex + match[1].length;
}

// node_modules/@nodable/entities/src/entities.js
var CURRENCY = {
  cent: "\xA2",
  pound: "\xA3",
  curren: "\xA4",
  yen: "\xA5",
  euro: "\u20AC",
  dollar: "$",
  fnof: "\u0192",
  inr: "\u20B9",
  af: "\u060B",
  birr: "\u1265\u122D",
  peso: "\u20B1",
  rub: "\u20BD",
  won: "\u20A9",
  yuan: "\xA5",
  cedil: "\xB8"
};
var XML = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"'
};
var COMMON_HTML = {
  nbsp: "\xA0",
  copy: "\xA9",
  reg: "\xAE",
  trade: "\u2122",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  laquo: "\xAB",
  raquo: "\xBB",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  bull: "\u2022",
  para: "\xB6",
  sect: "\xA7",
  deg: "\xB0",
  frac12: "\xBD",
  frac14: "\xBC",
  frac34: "\xBE"
};

// node_modules/@nodable/entities/src/EntityDecoder.js
var ENTITY_ACTION = Object.freeze({
  /** Resolve and expand the entity normally. */
  ALLOW: "allow",
  /** Silently skip this entity — it will not be registered. */
  BLOCK: "block",
  /** Throw an error, aborting entity registration entirely. */
  THROW: "throw"
});
var SPECIAL_CHARS = new Set("!?\\\\/[]$%{}^&*()<>|+");
function validateEntityName(name) {
  if (name[0] === "#") {
    throw new Error(`[EntityReplacer] Invalid character '#' in entity name: "${name}"`);
  }
  for (const ch of name) {
    if (SPECIAL_CHARS.has(ch)) {
      throw new Error(`[EntityReplacer] Invalid character '${ch}' in entity name: "${name}"`);
    }
  }
  return name;
}
function mergeEntityMaps(...maps) {
  const out = /* @__PURE__ */ Object.create(null);
  for (const map of maps) {
    if (!map) continue;
    for (const key of Object.keys(map)) {
      const raw = map[key];
      if (typeof raw === "string") {
        out[key] = raw;
      } else if (raw && typeof raw === "object" && raw.val !== void 0) {
        const val = raw.val;
        if (typeof val === "string") {
          out[key] = val;
        }
      }
    }
  }
  return out;
}
var LIMIT_TIER_EXTERNAL = "external";
var LIMIT_TIER_BASE = "base";
var LIMIT_TIER_ALL = "all";
function parseLimitTiers(raw) {
  if (!raw || raw === LIMIT_TIER_EXTERNAL) return /* @__PURE__ */ new Set([LIMIT_TIER_EXTERNAL]);
  if (raw === LIMIT_TIER_ALL) return /* @__PURE__ */ new Set([LIMIT_TIER_ALL]);
  if (raw === LIMIT_TIER_BASE) return /* @__PURE__ */ new Set([LIMIT_TIER_BASE]);
  if (Array.isArray(raw)) return new Set(raw);
  return /* @__PURE__ */ new Set([LIMIT_TIER_EXTERNAL]);
}
var NCR_LEVEL = Object.freeze({ allow: 0, leave: 1, remove: 2, throw: 3 });
var XML10_ALLOWED_C0 = /* @__PURE__ */ new Set([9, 10, 13]);
function parseNCRConfig(ncr) {
  if (!ncr) {
    return { xmlVersion: 1, onLevel: NCR_LEVEL.allow, nullLevel: NCR_LEVEL.remove };
  }
  const xmlVersion = ncr.xmlVersion === 1.1 ? 1.1 : 1;
  const onLevel = NCR_LEVEL[ncr.onNCR] ?? NCR_LEVEL.allow;
  const nullLevel = NCR_LEVEL[ncr.nullNCR] ?? NCR_LEVEL.remove;
  const clampedNull = Math.max(nullLevel, NCR_LEVEL.remove);
  return { xmlVersion, onLevel, nullLevel: clampedNull };
}
var EntityDecoder = class {
  /**
   * @param {object} [options]
   * @param {object|null}  [options.namedEntities]        — extra named entities merged into base map
   * @param {object}  [options.limit]                 — security limits
   * @param {number}       [options.limit.maxTotalExpansions=0]  — 0 = unlimited
   * @param {number}       [options.limit.maxExpandedLength=0]   — 0 = unlimited
   * @param {'external'|'base'|'all'|string[]} [options.limit.applyLimitsTo='external']
   *   Which entity tiers count against the security limits:
   *   - 'external' (default) — only input/runtime + persistent external entities
   *   - 'base'               — only DEFAULT_XML_ENTITIES + namedEntities
   *   - 'all'                — every entity regardless of tier
   *   - string[]             — explicit combination, e.g. ['external', 'base']
   * @param {((resolved: string, original: string) => string)|null} [options.postCheck=null]
   * @param {string[]} [options.remove=[]] — entity names (e.g. ['nbsp', '#13']) to delete (replace with empty string)
   * @param {string[]} [options.leave=[]]  — entity names to keep as literal (unchanged in output)
   * @param {object}   [options.ncr]       — Numeric Character Reference controls
   * @param {1.0|1.1}  [options.ncr.xmlVersion=1.0]
   *   XML version governing which codepoint ranges are restricted:
   *   - 1.0 — C0 controls U+0001–U+001F (except U+0009/000A/000D) are prohibited
   *   - 1.1 — C0 controls are allowed when written as NCRs; C1 (U+007F–U+009F) decoded as-is
   * @param {'allow'|'leave'|'remove'|'throw'} [options.ncr.onNCR='allow']
   *   Base action for numeric references. Severity order: allow < leave < remove < throw.
   *   For codepoint ranges that carry a minimum level (surrogates → remove, XML 1.0 C0 → remove),
   *   the effective action is max(onNCR, rangeMinimum).
   * @param {'remove'|'throw'} [options.ncr.nullNCR='remove']
   *   Action for U+0000 (null). 'allow' and 'leave' are clamped to 'remove' since null is never safe.
   * @param {((name: string, value: string) => 'allow'|'block'|'throw')|null} [options.onExternalEntity=null]
   *   Hook called when an external entity is registered via `setExternalEntities()` or
   *   `addExternalEntity()`. Return `ENTITY_ACTION.ALLOW` to accept the entity,
   *   `ENTITY_ACTION.BLOCK` to silently skip it, or `ENTITY_ACTION.THROW` to abort with an error.
   * @param {((name: string, value: string) => 'allow'|'block'|'throw')|null} [options.onInputEntity=null]
   *   Hook called when an input entity is registered via `addInputEntities()`. Return
   *   `ENTITY_ACTION.ALLOW` to accept, `ENTITY_ACTION.BLOCK` to silently skip, or
   *   `ENTITY_ACTION.THROW` to abort with an error.
   */
  constructor(options = {}) {
    this._limit = options.limit || {};
    this._maxTotalExpansions = this._limit.maxTotalExpansions || 0;
    this._maxExpandedLength = this._limit.maxExpandedLength || 0;
    this._postCheck = typeof options.postCheck === "function" ? options.postCheck : (r) => r;
    this._limitTiers = parseLimitTiers(this._limit.applyLimitsTo ?? LIMIT_TIER_EXTERNAL);
    this._numericAllowed = options.numericAllowed ?? true;
    this._baseMap = mergeEntityMaps(XML, options.namedEntities || null);
    this._externalMap = /* @__PURE__ */ Object.create(null);
    this._inputMap = /* @__PURE__ */ Object.create(null);
    this._totalExpansions = 0;
    this._expandedLength = 0;
    this._removeSet = new Set(options.remove && Array.isArray(options.remove) ? options.remove : []);
    this._leaveSet = new Set(options.leave && Array.isArray(options.leave) ? options.leave : []);
    const ncrCfg = parseNCRConfig(options.ncr);
    this._ncrXmlVersion = ncrCfg.xmlVersion;
    this._ncrOnLevel = ncrCfg.onLevel;
    this._ncrNullLevel = ncrCfg.nullLevel;
    this._onExternalEntity = typeof options.onExternalEntity === "function" ? options.onExternalEntity : null;
    this._onInputEntity = typeof options.onInputEntity === "function" ? options.onInputEntity : null;
  }
  // -------------------------------------------------------------------------
  // Private: registration hook dispatch
  // -------------------------------------------------------------------------
  /**
   * Invoke a registration hook for a single entity name/value pair.
   * Returns true when the entity should be accepted, false when it should be
   * silently skipped (BLOCK), and throws when the hook returns THROW.
   *
   * @param {((name: string, value: string) => 'allow'|'block'|'throw')|null} hook
   * @param {string} name
   * @param {string} value
   * @param {string} context  — used in error messages ('external' | 'input')
   * @returns {boolean}  true = accept, false = skip
   */
  _applyRegistrationHook(hook, name, value, context) {
    if (!hook) return true;
    const action = hook(name, value);
    if (action === ENTITY_ACTION.BLOCK) return false;
    if (action === ENTITY_ACTION.THROW) {
      throw new Error(
        `[EntityDecoder] Registration of ${context} entity "&${name};" was rejected by hook`
      );
    }
    return true;
  }
  // -------------------------------------------------------------------------
  // Persistent external entity registration
  // -------------------------------------------------------------------------
  /**
   * Replace the full set of persistent external entities.
   * All keys are validated — throws on invalid characters.
   * If `onExternalEntity` is set, it is called once per entry; entries that
   * return `ENTITY_ACTION.BLOCK` are silently omitted, `ENTITY_ACTION.THROW`
   * aborts the whole call.
   * @param {Record<string, string | { regex?: RegExp, val: string }>} map
   */
  setExternalEntities(map) {
    if (map) {
      for (const key of Object.keys(map)) {
        validateEntityName(key);
      }
    }
    if (!this._onExternalEntity) {
      this._externalMap = mergeEntityMaps(map);
      return;
    }
    const flat = mergeEntityMaps(map);
    const filtered = /* @__PURE__ */ Object.create(null);
    for (const [name, value] of Object.entries(flat)) {
      if (this._applyRegistrationHook(this._onExternalEntity, name, value, "external")) {
        filtered[name] = value;
      }
    }
    this._externalMap = filtered;
  }
  /**
   * Add a single persistent external entity.
   * If `onExternalEntity` is set it is called before the entity is stored;
   * `ENTITY_ACTION.BLOCK` silently skips storage, `ENTITY_ACTION.THROW` raises.
   * @param {string} key
   * @param {string} value
   */
  addExternalEntity(key, value) {
    validateEntityName(key);
    if (typeof value === "string" && value.indexOf("&") === -1) {
      if (this._applyRegistrationHook(this._onExternalEntity, key, value, "external")) {
        this._externalMap[key] = value;
      }
    }
  }
  // -------------------------------------------------------------------------
  // Input / runtime entity registration (per document)
  // -------------------------------------------------------------------------
  /**
   * Inject DOCTYPE entities for the current document.
   * Also resets per-document expansion counters.
   * If `onInputEntity` is set it is called once per entry; entries returning
   * `ENTITY_ACTION.BLOCK` are silently omitted, `ENTITY_ACTION.THROW` aborts.
   * @param {Record<string, string | { regx?: RegExp, regex?: RegExp, val: string }>} map
   */
  addInputEntities(map) {
    this._totalExpansions = 0;
    this._expandedLength = 0;
    if (!this._onInputEntity) {
      this._inputMap = mergeEntityMaps(map);
      return;
    }
    const flat = mergeEntityMaps(map);
    const filtered = /* @__PURE__ */ Object.create(null);
    for (const [name, value] of Object.entries(flat)) {
      if (this._applyRegistrationHook(this._onInputEntity, name, value, "input")) {
        filtered[name] = value;
      }
    }
    this._inputMap = filtered;
  }
  // -------------------------------------------------------------------------
  // Per-document reset
  // -------------------------------------------------------------------------
  /**
   * Wipe input/runtime entities and reset counters.
   * Call this before processing each new document.
   * @returns {this}
   */
  reset() {
    this._inputMap = /* @__PURE__ */ Object.create(null);
    this._totalExpansions = 0;
    this._expandedLength = 0;
    return this;
  }
  // -------------------------------------------------------------------------
  // XML version (can be set after construction, e.g. once parser reads <?xml?>)
  // -------------------------------------------------------------------------
  /**
   * Update the XML version used for NCR classification.
   * Call this as soon as the document's `<?xml version="...">` declaration is parsed.
   * @param {1.0|1.1|number} version
   */
  setXmlVersion(version) {
    this._ncrXmlVersion = version === 1.1 ? 1.1 : 1;
  }
  // -------------------------------------------------------------------------
  // Primary API
  // -------------------------------------------------------------------------
  /**
   * Replace all entity references in `str` in a single pass.
   *
   * @param {string} str
   * @returns {string}
   */
  decode(str) {
    if (typeof str !== "string" || str.length === 0) return str;
    if (str.indexOf("&") === -1) return str;
    const original = str;
    const chunks = [];
    const len = str.length;
    let last = 0;
    let i = 0;
    const limitExpansions = this._maxTotalExpansions > 0;
    const limitLength = this._maxExpandedLength > 0;
    const checkLimits = limitExpansions || limitLength;
    while (i < len) {
      if (str.charCodeAt(i) !== 38) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < len && str.charCodeAt(j) !== 59 && j - i <= 32) j++;
      if (j >= len || str.charCodeAt(j) !== 59) {
        i++;
        continue;
      }
      const token = str.slice(i + 1, j);
      if (token.length === 0) {
        i++;
        continue;
      }
      let replacement;
      let tier;
      if (this._removeSet.has(token)) {
        replacement = "";
        if (tier === void 0) {
          tier = LIMIT_TIER_EXTERNAL;
        }
      } else if (this._leaveSet.has(token)) {
        i++;
        continue;
      } else if (token.charCodeAt(0) === 35) {
        const ncrResult = this._resolveNCR(token);
        if (ncrResult === void 0) {
          i++;
          continue;
        }
        replacement = ncrResult;
        tier = LIMIT_TIER_BASE;
      } else {
        const resolved = this._resolveName(token);
        replacement = resolved?.value;
        tier = resolved?.tier;
      }
      if (replacement === void 0) {
        i++;
        continue;
      }
      if (i > last) chunks.push(str.slice(last, i));
      chunks.push(replacement);
      last = j + 1;
      i = last;
      if (checkLimits && this._tierCounts(tier)) {
        if (limitExpansions) {
          this._totalExpansions++;
          if (this._totalExpansions > this._maxTotalExpansions) {
            throw new Error(
              `[EntityReplacer] Entity expansion count limit exceeded: ${this._totalExpansions} > ${this._maxTotalExpansions}`
            );
          }
        }
        if (limitLength) {
          const delta = replacement.length - (token.length + 2);
          if (delta > 0) {
            this._expandedLength += delta;
            if (this._expandedLength > this._maxExpandedLength) {
              throw new Error(
                `[EntityReplacer] Expanded content length limit exceeded: ${this._expandedLength} > ${this._maxExpandedLength}`
              );
            }
          }
        }
      }
    }
    if (last < len) chunks.push(str.slice(last));
    const result = chunks.length === 0 ? str : chunks.join("");
    return this._postCheck(result, original);
  }
  // -------------------------------------------------------------------------
  // Private: limit tier check
  // -------------------------------------------------------------------------
  /**
   * Returns true if a resolved entity of the given tier should count
   * against the expansion/length limits.
   * @param {string} tier  — LIMIT_TIER_EXTERNAL | LIMIT_TIER_BASE
   * @returns {boolean}
   */
  _tierCounts(tier) {
    if (this._limitTiers.has(LIMIT_TIER_ALL)) return true;
    return this._limitTiers.has(tier);
  }
  // -------------------------------------------------------------------------
  // Private: entity resolution
  // -------------------------------------------------------------------------
  /**
   * Resolve a named entity token (without & and ;).
   * Priority: inputMap > externalMap > baseMap
   * Returns the resolved value tagged with its limit tier.
   *
   * @param {string} name
   * @returns {{ value: string, tier: string }|undefined}
   */
  _resolveName(name) {
    if (name in this._inputMap) return { value: this._inputMap[name], tier: LIMIT_TIER_EXTERNAL };
    if (name in this._externalMap) return { value: this._externalMap[name], tier: LIMIT_TIER_EXTERNAL };
    if (name in this._baseMap) return { value: this._baseMap[name], tier: LIMIT_TIER_BASE };
    return void 0;
  }
  /**
   * Classify a codepoint and return the minimum action level that must be applied.
   * Returns -1 when no minimum is imposed (normal allow path).
   *
   * Ranges checked (in priority order):
   *   1. U+0000            — null, governed by nullNCR (always ≥ remove)
   *   2. U+D800–U+DFFF     — surrogates, always prohibited (min: remove)
   *   3. U+0001–U+001F \ {0x09,0x0A,0x0D}  — XML 1.0 restricted C0 (min: remove)
   *      (skipped in XML 1.1 — C0 controls are allowed when written as NCRs)
   *
   * @param {number} cp  — codepoint
   * @returns {number}   — minimum NCR_LEVEL value, or -1 for no restriction
   */
  _classifyNCR(cp) {
    if (cp === 0) return this._ncrNullLevel;
    if (cp >= 55296 && cp <= 57343) return NCR_LEVEL.remove;
    if (this._ncrXmlVersion === 1) {
      if (cp >= 1 && cp <= 31 && !XML10_ALLOWED_C0.has(cp)) return NCR_LEVEL.remove;
    }
    return -1;
  }
  /**
   * Execute a resolved NCR action.
   *
   * @param {number} action   — NCR_LEVEL value
   * @param {string} token    — raw token (e.g. '#38') for error messages
   * @param {number} cp       — codepoint, used only for error messages
   * @returns {string|undefined}
   *   - decoded character string  → 'allow'
   *   - ''                        → 'remove'
   *   - undefined                 → 'leave' (caller must skip past '&' only)
   *   - throws Error              → 'throw'
   */
  _applyNCRAction(action, token, cp) {
    switch (action) {
      case NCR_LEVEL.allow:
        return String.fromCodePoint(cp);
      case NCR_LEVEL.remove:
        return "";
      case NCR_LEVEL.leave:
        return void 0;
      // signal: keep literal
      case NCR_LEVEL.throw:
        throw new Error(
          `[EntityDecoder] Prohibited numeric character reference &${token}; (U+${cp.toString(16).toUpperCase().padStart(4, "0")})`
        );
      default:
        return String.fromCodePoint(cp);
    }
  }
  /**
   * Full NCR resolution pipeline for a numeric token.
   *
   * Steps:
   *   1. Parse the codepoint (decimal or hex).
   *   2. Validate the raw codepoint range (NaN, <0, >0x10FFFF).
   *   3. If numericAllowed is false and no minimum restriction applies → leave as-is.
   *   4. Classify the codepoint to find the minimum required action level.
   *   5. Resolve effective action = max(onNCR, minimum).
   *   6. Apply and return.
   *
   * @param {string} token  — e.g. '#38', '#x26', '#X26'
   * @returns {string|undefined}
   *   - string (incl. '')  — replacement ('' = remove)
   *   - undefined          — leave original &token; as-is
   */
  _resolveNCR(token) {
    const second = token.charCodeAt(1);
    let cp;
    if (second === 120 || second === 88) {
      cp = parseInt(token.slice(2), 16);
    } else {
      cp = parseInt(token.slice(1), 10);
    }
    if (Number.isNaN(cp) || cp < 0 || cp > 1114111) return void 0;
    const minimum = this._classifyNCR(cp);
    if (!this._numericAllowed && minimum < NCR_LEVEL.remove) return void 0;
    const effective = minimum === -1 ? this._ncrOnLevel : Math.max(this._ncrOnLevel, minimum);
    return this._applyNCRAction(effective, token, cp);
  }
};

// node_modules/fast-xml-parser/src/xmlparser/OptionsBuilder.js
var defaultOnDangerousProperty = (name) => {
  if (DANGEROUS_PROPERTY_NAMES.includes(name)) {
    return "__" + name;
  }
  return name;
};
var defaultOptions2 = {
  preserveOrder: false,
  attributeNamePrefix: "@_",
  attributesGroupName: false,
  textNodeName: "#text",
  ignoreAttributes: true,
  removeNSPrefix: false,
  // remove NS from tag name or attribute name if true
  allowBooleanAttributes: false,
  //a tag can have attributes without any value
  //ignoreRootElement : false,
  parseTagValue: true,
  parseAttributeValue: false,
  trimValues: true,
  //Trim string values of tag and attributes
  cdataPropName: false,
  numberParseOptions: {
    hex: true,
    leadingZeros: true,
    eNotation: true,
    unicode: false
  },
  tagValueProcessor: function(tagName, val) {
    return val;
  },
  attributeValueProcessor: function(attrName, val) {
    return val;
  },
  stopNodes: [],
  //nested tags will not be parsed even for errors
  alwaysCreateTextNode: false,
  isArray: () => false,
  commentPropName: false,
  unpairedTags: [],
  processEntities: true,
  htmlEntities: false,
  entityDecoder: null,
  ignoreDeclaration: false,
  ignorePiTags: false,
  transformTagName: false,
  transformAttributeName: false,
  updateTag: function(tagName, jPath, attrs) {
    return tagName;
  },
  // skipEmptyListItem: false
  captureMetaData: false,
  maxNestedTags: 100,
  strictReservedNames: true,
  jPath: true,
  // if true, pass jPath string to callbacks; if false, pass matcher instance
  onDangerousProperty: defaultOnDangerousProperty
};
function validatePropertyName(propertyName, optionName) {
  if (typeof propertyName !== "string") {
    return;
  }
  const normalized = propertyName.toLowerCase();
  if (DANGEROUS_PROPERTY_NAMES.some((dangerous) => normalized === dangerous.toLowerCase())) {
    throw new Error(
      `[SECURITY] Invalid ${optionName}: "${propertyName}" is a reserved JavaScript keyword that could cause prototype pollution`
    );
  }
  if (criticalProperties.some((dangerous) => normalized === dangerous.toLowerCase())) {
    throw new Error(
      `[SECURITY] Invalid ${optionName}: "${propertyName}" is a reserved JavaScript keyword that could cause prototype pollution`
    );
  }
}
function normalizeProcessEntities(value, htmlEntities) {
  if (typeof value === "boolean") {
    return {
      enabled: value,
      // true or false
      maxEntitySize: 1e4,
      maxExpansionDepth: 1e4,
      maxTotalExpansions: Infinity,
      maxExpandedLength: 1e5,
      maxEntityCount: 1e3,
      allowedTags: null,
      tagFilter: null,
      appliesTo: "all"
    };
  }
  if (typeof value === "object" && value !== null) {
    return {
      enabled: value.enabled !== false,
      maxEntitySize: Math.max(1, value.maxEntitySize ?? 1e4),
      maxExpansionDepth: Math.max(1, value.maxExpansionDepth ?? 1e4),
      maxTotalExpansions: Math.max(1, value.maxTotalExpansions ?? Infinity),
      maxExpandedLength: Math.max(1, value.maxExpandedLength ?? 1e5),
      maxEntityCount: Math.max(1, value.maxEntityCount ?? 1e3),
      allowedTags: value.allowedTags ?? null,
      tagFilter: value.tagFilter ?? null,
      appliesTo: value.appliesTo ?? "all"
    };
  }
  return normalizeProcessEntities(true);
}
var buildOptions = function(options) {
  const built = Object.assign({}, defaultOptions2, options);
  const propertyNameOptions = [
    { value: built.attributeNamePrefix, name: "attributeNamePrefix" },
    { value: built.attributesGroupName, name: "attributesGroupName" },
    { value: built.textNodeName, name: "textNodeName" },
    { value: built.cdataPropName, name: "cdataPropName" },
    { value: built.commentPropName, name: "commentPropName" }
  ];
  for (const { value, name } of propertyNameOptions) {
    if (value) {
      validatePropertyName(value, name);
    }
  }
  if (built.onDangerousProperty === null) {
    built.onDangerousProperty = defaultOnDangerousProperty;
  }
  built.processEntities = normalizeProcessEntities(built.processEntities, built.htmlEntities);
  built.unpairedTagsSet = new Set(built.unpairedTags);
  if (built.stopNodes && Array.isArray(built.stopNodes)) {
    built.stopNodes = built.stopNodes.map((node) => {
      if (typeof node === "string" && node.startsWith("*.")) {
        return ".." + node.substring(2);
      }
      return node;
    });
  }
  return built;
};

// node_modules/fast-xml-parser/src/xmlparser/xmlNode.js
var METADATA_SYMBOL;
if (typeof Symbol !== "function") {
  METADATA_SYMBOL = "@@xmlMetadata";
} else {
  METADATA_SYMBOL = /* @__PURE__ */ Symbol("XML Node Metadata");
}
var XmlNode = class {
  constructor(tagname) {
    this.tagname = tagname;
    this.child = [];
    this[":@"] = /* @__PURE__ */ Object.create(null);
  }
  add(key, val) {
    if (key === "__proto__") key = "#__proto__";
    this.child.push({ [key]: val });
  }
  addChild(node, startIndex) {
    if (node.tagname === "__proto__") node.tagname = "#__proto__";
    if (node[":@"] && Object.keys(node[":@"]).length > 0) {
      this.child.push({ [node.tagname]: node.child, [":@"]: node[":@"] });
    } else {
      this.child.push({ [node.tagname]: node.child });
    }
    this.addStartIndex(startIndex);
  }
  addStartIndex(startIndex) {
    if (startIndex !== void 0) {
      this.child[this.child.length - 1][METADATA_SYMBOL] = { startIndex };
    }
  }
  addEndIndex(endIndex) {
    const lastChild = this.child[this.child.length - 1];
    if (lastChild !== void 0 && lastChild[METADATA_SYMBOL] !== void 0 && lastChild[METADATA_SYMBOL].endIndex === void 0) {
      lastChild[METADATA_SYMBOL].endIndex = endIndex;
    }
  }
  /** symbol used for metadata */
  static getMetaDataSymbol() {
    return METADATA_SYMBOL;
  }
};

// node_modules/xml-naming/src/index.js
var nameStartChar10 = ":A-Za-z_\xC0-\xD6\xD8-\xF6\xF8-\u02FF\u0370-\u037D\u037F-\u0486\u0488-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD";
var nameChar10 = nameStartChar10 + "\\-\\.\\d\xB7\u0300-\u036F\u203F-\u2040";
var nameStartChar11 = ":A-Za-z_\xC0-\u02FF\u0370-\u037D\u037F-\u0486\u0488-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u{10000}-\u{EFFFF}";
var nameChar11 = nameStartChar11 + "\\-\\.\\d\xB7\u0300-\u036F\u0487\u203F-\u2040";
var buildRegexes = (startChar, char, flags = "") => {
  const ncStart = startChar.replace(":", "");
  const ncChar = char.replace(":", "");
  const ncNamePat = `[${ncStart}][${ncChar}]*`;
  return {
    name: new RegExp(`^[${startChar}][${char}]*$`, flags),
    ncName: new RegExp(`^${ncNamePat}$`, flags),
    qName: new RegExp(`^${ncNamePat}(?::${ncNamePat})?$`, flags),
    nmToken: new RegExp(`^[${char}]+$`, flags),
    nmTokens: new RegExp(`^[${char}]+(?:\\s+[${char}]+)*$`, flags)
  };
};
var regexes10 = buildRegexes(nameStartChar10, nameChar10);
var regexes11 = buildRegexes(nameStartChar11, nameChar11, "u");
var nameStartCharAscii = ":A-Za-z_";
var nameCharAscii = nameStartCharAscii + "\\-\\.\\d";
var regexesAscii = buildRegexes(nameStartCharAscii, nameCharAscii);
var getRegexes = (xmlVersion = "1.0", asciiOnly = false) => {
  if (asciiOnly) return regexesAscii;
  return xmlVersion === "1.1" ? regexes11 : regexes10;
};
var qName = (str, { xmlVersion = "1.0", asciiOnly = false } = {}) => getRegexes(xmlVersion, asciiOnly).qName.test(str);

// node_modules/fast-xml-parser/src/xmlparser/DocTypeReader.js
var DocTypeReader = class {
  constructor(options, xmlVersion) {
    this.suppressValidationErr = !options;
    this.options = options;
    this.xmlVersion = xmlVersion || 1;
  }
  setXmlVersion(xmlVersion = 1) {
    this.xmlVersion = xmlVersion;
  }
  readDocType(xmlData, i) {
    const entities = /* @__PURE__ */ Object.create(null);
    let entityCount = 0;
    if (xmlData[i + 3] === "O" && xmlData[i + 4] === "C" && xmlData[i + 5] === "T" && xmlData[i + 6] === "Y" && xmlData[i + 7] === "P" && xmlData[i + 8] === "E") {
      i = i + 9;
      let angleBracketsCount = 1;
      let hasBody = false, comment = false;
      let quoteChar = null;
      let exp = "";
      for (; i < xmlData.length; i++) {
        if (quoteChar !== null) {
          if (xmlData[i] === quoteChar) quoteChar = null;
          exp += xmlData[i];
          continue;
        }
        if (!hasBody && !comment && (xmlData[i] === '"' || xmlData[i] === "'")) {
          quoteChar = xmlData[i];
          exp += xmlData[i];
          continue;
        }
        if (xmlData[i] === "<" && !comment) {
          if (hasBody && hasSeq(xmlData, "!ENTITY", i)) {
            i += 7;
            let entityName, val;
            [entityName, val, i] = this.readEntityExp(xmlData, i + 1, this.suppressValidationErr);
            if (val.indexOf("&") === -1) {
              if (this.options.enabled !== false && this.options.maxEntityCount != null && entityCount >= this.options.maxEntityCount) {
                throw new Error(
                  `Entity count (${entityCount + 1}) exceeds maximum allowed (${this.options.maxEntityCount})`
                );
              }
              entities[entityName] = val;
              entityCount++;
            }
          } else if (hasBody && hasSeq(xmlData, "!ELEMENT", i)) {
            i += 8;
            const { index } = this.readElementExp(xmlData, i + 1);
            i = index;
          } else if (hasBody && hasSeq(xmlData, "!ATTLIST", i)) {
            i += 8;
          } else if (hasBody && hasSeq(xmlData, "!NOTATION", i)) {
            i += 9;
            const { index } = this.readNotationExp(xmlData, i + 1, this.suppressValidationErr);
            i = index;
          } else if (hasSeq(xmlData, "!--", i)) comment = true;
          else throw new Error(`Invalid DOCTYPE`);
          angleBracketsCount++;
          exp = "";
        } else if (xmlData[i] === ">") {
          if (comment) {
            if (xmlData[i - 1] === "-" && xmlData[i - 2] === "-") {
              comment = false;
              angleBracketsCount--;
            }
          } else {
            angleBracketsCount--;
          }
          if (angleBracketsCount === 0) {
            break;
          }
        } else if (xmlData[i] === "[") {
          hasBody = true;
        } else {
          exp += xmlData[i];
        }
      }
      if (quoteChar !== null || angleBracketsCount !== 0) {
        throw new Error(`Unclosed DOCTYPE`);
      }
    } else {
      throw new Error(`Invalid Tag instead of DOCTYPE`);
    }
    return { entities, i };
  }
  readEntityExp(xmlData, i) {
    i = skipWhitespace(xmlData, i);
    const startIndex = i;
    while (i < xmlData.length && !/\s/.test(xmlData[i]) && xmlData[i] !== '"' && xmlData[i] !== "'") {
      i++;
    }
    let entityName = xmlData.substring(startIndex, i);
    validateEntityName2(entityName, { xmlVersion: this.xmlVersion });
    i = skipWhitespace(xmlData, i);
    if (!this.suppressValidationErr) {
      if (xmlData.substring(i, i + 6).toUpperCase() === "SYSTEM") {
        throw new Error("External entities are not supported");
      } else if (xmlData[i] === "%") {
        throw new Error("Parameter entities are not supported");
      }
    }
    let entityValue = "";
    [i, entityValue] = this.readIdentifierVal(xmlData, i, "entity");
    if (this.options.enabled !== false && this.options.maxEntitySize != null && entityValue.length > this.options.maxEntitySize) {
      throw new Error(
        `Entity "${entityName}" size (${entityValue.length}) exceeds maximum allowed size (${this.options.maxEntitySize})`
      );
    }
    i--;
    return [entityName, entityValue, i];
  }
  readNotationExp(xmlData, i) {
    i = skipWhitespace(xmlData, i);
    const startIndex = i;
    while (i < xmlData.length && !/\s/.test(xmlData[i])) {
      i++;
    }
    let notationName = xmlData.substring(startIndex, i);
    !this.suppressValidationErr && validateEntityName2(notationName, { xmlVersion: this.xmlVersion });
    i = skipWhitespace(xmlData, i);
    const identifierType = xmlData.substring(i, i + 6).toUpperCase();
    if (!this.suppressValidationErr && identifierType !== "SYSTEM" && identifierType !== "PUBLIC") {
      throw new Error(`Expected SYSTEM or PUBLIC, found "${identifierType}"`);
    }
    i += identifierType.length;
    i = skipWhitespace(xmlData, i);
    let publicIdentifier = null;
    let systemIdentifier = null;
    if (identifierType === "PUBLIC") {
      [i, publicIdentifier] = this.readIdentifierVal(xmlData, i, "publicIdentifier");
      i = skipWhitespace(xmlData, i);
      if (xmlData[i] === '"' || xmlData[i] === "'") {
        [i, systemIdentifier] = this.readIdentifierVal(xmlData, i, "systemIdentifier");
      }
    } else if (identifierType === "SYSTEM") {
      [i, systemIdentifier] = this.readIdentifierVal(xmlData, i, "systemIdentifier");
      if (!this.suppressValidationErr && !systemIdentifier) {
        throw new Error("Missing mandatory system identifier for SYSTEM notation");
      }
    }
    return { notationName, publicIdentifier, systemIdentifier, index: --i };
  }
  readIdentifierVal(xmlData, i, type) {
    let identifierVal = "";
    const startChar = xmlData[i];
    if (startChar !== '"' && startChar !== "'") {
      throw new Error(`Expected quoted string, found "${startChar}"`);
    }
    i++;
    const startIndex = i;
    while (i < xmlData.length && xmlData[i] !== startChar) {
      i++;
    }
    identifierVal = xmlData.substring(startIndex, i);
    if (xmlData[i] !== startChar) {
      throw new Error(`Unterminated ${type} value`);
    }
    i++;
    return [i, identifierVal];
  }
  readElementExp(xmlData, i) {
    i = skipWhitespace(xmlData, i);
    const startIndex = i;
    while (i < xmlData.length && !/\s/.test(xmlData[i])) {
      i++;
    }
    let elementName = xmlData.substring(startIndex, i);
    if (!this.suppressValidationErr && !qName(elementName, { xmlVersion: this.xmlVersion })) {
      throw new Error(`Invalid element name: "${elementName}"`);
    }
    i = skipWhitespace(xmlData, i);
    let contentModel = "";
    if (xmlData[i] === "E" && hasSeq(xmlData, "MPTY", i)) i += 4;
    else if (xmlData[i] === "A" && hasSeq(xmlData, "NY", i)) i += 2;
    else if (xmlData[i] === "(") {
      i++;
      const startIndex2 = i;
      while (i < xmlData.length && xmlData[i] !== ")") {
        i++;
      }
      contentModel = xmlData.substring(startIndex2, i);
      if (xmlData[i] !== ")") {
        throw new Error("Unterminated content model");
      }
    } else if (!this.suppressValidationErr) {
      throw new Error(`Invalid Element Expression, found "${xmlData[i]}"`);
    }
    return {
      elementName,
      contentModel: contentModel.trim(),
      index: i
    };
  }
  readAttlistExp(xmlData, i) {
    i = skipWhitespace(xmlData, i);
    let startIndex = i;
    while (i < xmlData.length && !/\s/.test(xmlData[i])) {
      i++;
    }
    let elementName = xmlData.substring(startIndex, i);
    validateEntityName2(elementName, { xmlVersion: this.xmlVersion });
    i = skipWhitespace(xmlData, i);
    startIndex = i;
    while (i < xmlData.length && !/\s/.test(xmlData[i])) {
      i++;
    }
    let attributeName = xmlData.substring(startIndex, i);
    if (!validateEntityName2(attributeName, { xmlVersion: this.xmlVersion })) {
      throw new Error(`Invalid attribute name: "${attributeName}"`);
    }
    i = skipWhitespace(xmlData, i);
    let attributeType = "";
    if (xmlData.substring(i, i + 8).toUpperCase() === "NOTATION") {
      attributeType = "NOTATION";
      i += 8;
      i = skipWhitespace(xmlData, i);
      if (xmlData[i] !== "(") {
        throw new Error(`Expected '(', found "${xmlData[i]}"`);
      }
      i++;
      let allowedNotations = [];
      while (i < xmlData.length && xmlData[i] !== ")") {
        const startIndex2 = i;
        while (i < xmlData.length && xmlData[i] !== "|" && xmlData[i] !== ")") {
          i++;
        }
        let notation = xmlData.substring(startIndex2, i);
        notation = notation.trim();
        if (!validateEntityName2(notation, { xmlVersion: this.xmlVersion })) {
          throw new Error(`Invalid notation name: "${notation}"`);
        }
        allowedNotations.push(notation);
        if (xmlData[i] === "|") {
          i++;
          i = skipWhitespace(xmlData, i);
        }
      }
      if (xmlData[i] !== ")") {
        throw new Error("Unterminated list of notations");
      }
      i++;
      attributeType += " (" + allowedNotations.join("|") + ")";
    } else {
      const startIndex2 = i;
      while (i < xmlData.length && !/\s/.test(xmlData[i])) {
        i++;
      }
      attributeType += xmlData.substring(startIndex2, i);
      const validTypes = ["CDATA", "ID", "IDREF", "IDREFS", "ENTITY", "ENTITIES", "NMTOKEN", "NMTOKENS"];
      if (!this.suppressValidationErr && !validTypes.includes(attributeType.toUpperCase())) {
        throw new Error(`Invalid attribute type: "${attributeType}"`);
      }
    }
    i = skipWhitespace(xmlData, i);
    let defaultValue = "";
    if (xmlData.substring(i, i + 8).toUpperCase() === "#REQUIRED") {
      defaultValue = "#REQUIRED";
      i += 8;
    } else if (xmlData.substring(i, i + 7).toUpperCase() === "#IMPLIED") {
      defaultValue = "#IMPLIED";
      i += 7;
    } else {
      [i, defaultValue] = this.readIdentifierVal(xmlData, i, "ATTLIST");
    }
    return {
      elementName,
      attributeName,
      attributeType,
      defaultValue,
      index: i
    };
  }
};
var skipWhitespace = (data, index) => {
  while (index < data.length && /\s/.test(data[index])) {
    index++;
  }
  return index;
};
function hasSeq(data, seq, i) {
  for (let j = 0; j < seq.length; j++) {
    if (seq[j] !== data[i + j + 1]) return false;
  }
  return true;
}
function validateEntityName2(name, xmlVersion) {
  if (qName(name, { xmlVersion }))
    return name;
  else
    throw new Error(`Invalid entity name ${name}`);
}

// node_modules/anynum/digitTable.js
var SCRIPT_ZEROS = [
  // Basic Latin (ASCII) — included for completeness / pass-through
  48,
  // 0-9
  // Arabic scripts
  1632,
  // Arabic-Indic ٠١٢٣٤٥٦٧٨٩
  1776,
  // Extended Arabic-Indic (Urdu/Persian/Sindhi) ۰۱۲۳
  // Indic scripts
  2406,
  // Devanagari ०१२३४५६७८९
  2534,
  // Bengali ০১২৩৪৫৬৭৮৯
  2662,
  // Gurmukhi ੦੧੨੩੪੫੬੭੮੯
  2790,
  // Gujarati ૦૧૨૩૪૫૬૭૮૯
  2918,
  // Odia ୦୧୨୩୪୫୬୭୮୯
  3046,
  // Tamil ௦௧௨௩௪௫௬௭௮௯
  3174,
  // Telugu ౦౧౨౩౪౫౬౭౮౯
  3302,
  // Kannada ೦೧೨೩೪೫೬೭೮೯
  3430,
  // Malayalam ൦൧൨൩൪൫൬൭൮൯
  3558,
  // Sinhala Archaic ෦෧෨෩෪෫෬෭෮෯
  // Southeast Asian scripts
  3664,
  // Thai ๐๑๒๓๔๕๖๗๘๙
  3792,
  // Lao ໐໑໒໓໔໕໖໗໘໙
  3872,
  // Tibetan ༠༡༢༣༤༥༦༧༨༩
  4160,
  // Myanmar ၀၁၂၃၄၅၆၇၈၉
  4240,
  // Myanmar Shan ႐႑႒႓႔႕႖႗႘႙
  6112,
  // Khmer ០១២៣៤៥៦៧៨៩
  6160,
  // Mongolian ᠐᠑᠒᠓᠔᠕᠖᠗᠘᠙
  6470,
  // Limbu ᥆᥇᥈᥉᥊᥋᥌᥍᥎᥏
  6608,
  // New Tai Lue ᧐᧑᧒᧓᧔᧕᧖᧗᧘᧙
  6784,
  // Tai Tham Hora ᪀᪁᪂᪃᪄᪅᪆᪇᪈᪉
  6800,
  // Tai Tham Tham ᪐᪑᪒᪓᪔᪕᪖᪗᪘᪙
  6992,
  // Balinese ᭐᭑᭒᭓᭔᭕᭖᭗᭘᭙
  7088,
  // Sundanese ᮰᮱᮲᮳᮴᮵᮶᮷᮸᮹
  7232,
  // Lepcha ᱀᱁᱂᱃᱄᱅᱆᱇᱈᱉
  7248,
  // Ol Chiki ᱐᱑᱒᱓᱔᱕᱖᱗᱘᱙
  // Fullwidth (CJK context)
  65296,
  // Fullwidth ０１２３４５６７８９
  // Mathematical digit variants (Unicode math block)
  120782,
  // Mathematical Bold
  120792,
  // Mathematical Double-Struck
  120802,
  // Mathematical Sans-Serif
  120812,
  // Mathematical Sans-Serif Bold
  120822,
  // Mathematical Monospace
  // Other scripts
  66720,
  // Osmanya 𐒠𐒡𐒢𐒣𐒤𐒥𐒦𐒧𐒨𐒩
  68912,
  // Hanifi Rohingya 𐴰𐴱𐴲𐴳𐴴𐴵𐴶𐴷𐴸𐴹
  69734,
  // Brahmi 𑁦𑁧𑁨𑁩𑁪𑁫𑁬𑁭𑁮𑁯
  69872,
  // Sora Sompeng 𑃰𑃱𑃲𑃳𑃴𑃵𑃶𑃷𑃸𑃹
  69942,
  // Chakma 𑄶𑄷𑄸𑄹𑄺𑄻𑄼𑄽𑄾𑄿
  70096,
  // Sharada 𑇐𑇑𑇒𑇓𑇔𑇕𑇖𑇗𑇘𑇙
  70384,
  // Khudawadi 𑋰𑋱𑋲𑋳𑋴𑋵𑋶𑋷𑋸𑋹
  70736,
  // Newa 𑑐𑑑𑑒𑑓𑑔𑑕𑑖𑑗𑑘𑑙
  70864,
  // Tirhuta 𑓐𑓑𑓒𑓓𑓔𑓕𑓖𑓗𑓘𑓙
  71248,
  // Modi 𑙐𑙑𑙒𑙓𑙔𑙕𑙖𑙗𑙘𑙙
  71360,
  // Takri 𑛀𑛁𑛂𑛃𑛄𑛅𑛆𑛇𑛈𑛉
  71472,
  // Ahom 𑜰𑜱𑜲𑜳𑜴𑜵𑜶𑜷𑜸𑜹
  71904,
  // Warang Citi 𑣠𑣡𑣢𑣣𑣤𑣥𑣦𑣧𑣨𑣩
  72016,
  // Dives Akuru 𑥐𑥑𑥒𑥓𑥔𑥕𑥖𑥗𑥘𑥙
  72688,
  // Khitan Small Script 𑯰𑯱𑯲𑯳𑯴𑯵𑯶𑯷𑯸𑯹
  72784,
  // Bhaiksuki 𑱐𑱑𑱒𑱓𑱔𑱕𑱖𑱗𑱘𑱙
  73040,
  // Masaram Gondi 𑵐𑵑𑵒𑵓𑵔𑵕𑵖𑵗𑵘𑵙
  73120,
  // Gunjala Gondi 𑶠𑶡𑶢𑶣𑶤𑶥𑶦𑶧𑶨𑶩
  73552,
  // Kawi 𑽐𑽑𑽒𑽓𑽔𑽕𑽖𑽗𑽘𑽙
  92768,
  // Mro 𖩠𖩡𖩢𖩣𖩤𖩥𖩦𖩧𖩨𖩩
  92864,
  // Tangsa 𖫀𖫁𖫂𖫃𖫄𖫅𖫆𖫇𖫈𖫉
  93008,
  // Pahawh Hmong 𖭐𖭑𖭒𖭓𖭔𖭕𖭖𖭗𖭘𖭙
  123200,
  // Nyiakeng Puachue Hmong 𞅀𞅁𞅂𞅃𞅄𞅅𞅆𞅇𞅈𞅉
  123632,
  // Wancho 𞋰𞋱𞋲𞋳𞋴𞋵𞋶𞋷𞋸𞋹
  124144,
  // Nag Mundari 𞓰𞓱𞓲𞓳𞓴𞓵𞓶𞓷𞓸𞓹
  125264,
  // Adlam 𞥐𞥑𞥒𞥓𞥔𞥕𞥖𞥗𞥘𞥙
  130032
  // Segmented digit symbols 🯰🯱🯲🯳🯴🯵🯶🯷🯸🯹
];
var NOT_DIGIT = 255;
var HIGH_MAP = /* @__PURE__ */ new Map();
var LOW_MAX = 65535;
var LOW_MIN = 1632;
var TABLE_OFFSET = LOW_MIN;
var TABLE_SIZE = LOW_MAX - LOW_MIN + 1;
var TABLE = new Uint8Array(TABLE_SIZE).fill(NOT_DIGIT);
for (const zero of SCRIPT_ZEROS) {
  for (let d2 = 0; d2 < 10; d2++) {
    const cp = zero + d2;
    if (cp <= LOW_MAX) {
      TABLE[cp - TABLE_OFFSET] = d2;
    } else {
      HIGH_MAP.set(cp, d2);
    }
  }
}

// node_modules/anynum/anynum.js
var CHAR_0 = 48;
var CHAR_9 = 57;
var CHAR_MINUS = 45;
var MINUS_SET = /* @__PURE__ */ new Set([8722, 65293, 65123]);
function anynum(str) {
  if (typeof str !== "string") return str;
  const len = str.length;
  if (len === 0) return str;
  let firstHit = -1;
  for (let i = 0; i < len; i++) {
    const cc = str.charCodeAt(i);
    if (cc >= CHAR_0 && cc <= CHAR_9 || cc === CHAR_MINUS) continue;
    if (cc < TABLE_OFFSET) {
      if (MINUS_SET.has(cc)) {
        firstHit = i;
        break;
      }
      continue;
    }
    if (cc >= 55296 && cc <= 56319) {
      if (i + 1 < len) {
        const low = str.charCodeAt(i + 1);
        if (low >= 56320 && low <= 57343) {
          const cp = 65536 + (cc - 55296 << 10) + (low - 56320);
          if (HIGH_MAP.has(cp)) {
            firstHit = i;
            break;
          }
        }
      }
      continue;
    }
    if (TABLE[cc - TABLE_OFFSET] !== NOT_DIGIT || MINUS_SET.has(cc)) {
      firstHit = i;
      break;
    }
  }
  if (firstHit === -1) return str;
  const chars = [];
  if (firstHit > 0) chars.push(str.slice(0, firstHit));
  for (let i = firstHit; i < len; i++) {
    const cc = str.charCodeAt(i);
    if (cc >= CHAR_0 && cc <= CHAR_9 || cc === CHAR_MINUS) {
      chars.push(str[i]);
      continue;
    }
    if (cc < TABLE_OFFSET) {
      chars.push(MINUS_SET.has(cc) ? "-" : str[i]);
      continue;
    }
    if (cc >= 55296 && cc <= 56319) {
      if (i + 1 < len) {
        const low = str.charCodeAt(i + 1);
        if (low >= 56320 && low <= 57343) {
          const cp = 65536 + (cc - 55296 << 10) + (low - 56320);
          const d3 = HIGH_MAP.get(cp);
          if (d3 !== void 0) {
            chars.push(String.fromCharCode(d3 + 48));
            i++;
            continue;
          }
        }
      }
      chars.push(str[i]);
      continue;
    }
    if (MINUS_SET.has(cc)) {
      chars.push("-");
      continue;
    }
    const d2 = TABLE[cc - TABLE_OFFSET];
    chars.push(d2 !== NOT_DIGIT ? String.fromCharCode(d2 + 48) : str[i]);
  }
  return chars.join("");
}
var anynum_default = anynum;

// node_modules/strnum/strnum.js
var hexRegex = /^[-+]?0x[a-fA-F0-9]+$/;
var binRegex = /^0b[01]+$/;
var octRegex = /^0o[0-7]+$/;
var numRegex = /^([\-\+])?(0*)([0-9]*(\.[0-9]*)?)$/;
var consider = {
  hex: true,
  binary: false,
  octal: false,
  leadingZeros: true,
  decimalPoint: ".",
  eNotation: true,
  //skipLike: /regex/,
  infinity: "original",
  // "null", "infinity" (Infinity type), "string" ("Infinity" (the string literal))
  unicode: false
};
function toNumber(str, options = {}) {
  options = Object.assign({}, consider, options);
  if (!str || typeof str !== "string") return str;
  let trimmedStr = str.trim();
  if (trimmedStr.length === 0) return str;
  else if (options.skipLike !== void 0 && options.skipLike.test(trimmedStr)) return str;
  else if (trimmedStr === "0") return 0;
  if (options.unicode) {
    trimmedStr = anynum_default(trimmedStr);
    if (trimmedStr === "0") return 0;
  }
  if (options.hex && hexRegex.test(trimmedStr)) {
    return parse_int(trimmedStr, 16);
  } else if (options.binary && binRegex.test(trimmedStr)) {
    return parse_int(trimmedStr, 2);
  } else if (options.octal && octRegex.test(trimmedStr)) {
    return parse_int(trimmedStr, 8);
  } else if (!isFinite(trimmedStr)) {
    const num = Number(trimmedStr);
    if (Number.isNaN(num)) return str;
    return handleInfinity(str, num, options);
  } else if (trimmedStr.includes("e") || trimmedStr.includes("E")) {
    return resolveEnotation(str, trimmedStr, options);
  } else {
    const match = numRegex.exec(trimmedStr);
    if (match) {
      const sign = match[1] || "";
      const leadingZeros = match[2];
      let numTrimmedByZeros = trimZeros(match[3]);
      const decimalAdjacentToLeadingZeros = sign ? (
        // 0., -00., 000.
        trimmedStr[leadingZeros.length + 1] === "."
      ) : trimmedStr[leadingZeros.length] === ".";
      if (!options.leadingZeros && (leadingZeros.length > 1 || leadingZeros.length === 1 && !decimalAdjacentToLeadingZeros)) {
        return str;
      } else {
        const num = Number(trimmedStr);
        const parsedStr = String(num);
        if (num === 0) return num;
        if (parsedStr.search(/[eE]/) !== -1) {
          if (options.eNotation) return num;
          else return str;
        } else if (trimmedStr.indexOf(".") !== -1) {
          if (parsedStr === "0") return num;
          else if (parsedStr === numTrimmedByZeros) return num;
          else if (parsedStr === `${sign}${numTrimmedByZeros}`) return num;
          else return str;
        }
        let n = leadingZeros ? numTrimmedByZeros : trimmedStr;
        if (leadingZeros) {
          return n === parsedStr || sign + n === parsedStr ? num : str;
        } else {
          return n === parsedStr || n === sign + parsedStr ? num : str;
        }
      }
    } else {
      return str;
    }
  }
}
var eNotationRegx = /^([-+])?(0*)(\d*(\.\d*)?[eE][-\+]?\d+)$/;
function resolveEnotation(str, trimmedStr, options) {
  if (!options.eNotation) return str;
  const notation = trimmedStr.match(eNotationRegx);
  if (notation) {
    let sign = notation[1] || "";
    const eChar = notation[3].indexOf("e") === -1 ? "E" : "e";
    const leadingZeros = notation[2];
    const eAdjacentToLeadingZeros = sign ? (
      // 0E.
      trimmedStr[leadingZeros.length + 1] === eChar
    ) : trimmedStr[leadingZeros.length] === eChar;
    if (leadingZeros.length > 1 && eAdjacentToLeadingZeros) return str;
    else if (leadingZeros.length === 1 && (notation[3].startsWith(`.${eChar}`) || notation[3][0] === eChar)) {
      return Number(trimmedStr);
    } else if (leadingZeros.length > 0) {
      if (options.leadingZeros && !eAdjacentToLeadingZeros) {
        return Number(trimmedStr);
      } else return str;
    } else {
      return Number(trimmedStr);
    }
  } else {
    return str;
  }
}
function trimZeros(numStr) {
  if (numStr && numStr.indexOf(".") !== -1) {
    let end = numStr.length;
    while (end > 0 && numStr.charCodeAt(end - 1) === 48) end--;
    numStr = numStr.slice(0, end);
    if (numStr === ".") numStr = "0";
    else if (numStr[0] === ".") numStr = "0" + numStr;
    else if (numStr[numStr.length - 1] === ".") numStr = numStr.substring(0, numStr.length - 1);
    return numStr;
  }
  return numStr;
}
function parse_int(numStr, base) {
  const str = numStr.trim();
  if (base === 2 || base === 8) numStr = str.substring(2);
  if (parseInt) return parseInt(numStr, base);
  else if (Number.parseInt) return Number.parseInt(numStr, base);
  else if (window && window.parseInt) return window.parseInt(numStr, base);
  else throw new Error("parseInt, Number.parseInt, window.parseInt are not supported");
}
function handleInfinity(str, num, options) {
  const isPositive = num === Infinity;
  switch (options.infinity.toLowerCase()) {
    case "null":
      return null;
    case "infinity":
      return num;
    // Return Infinity or -Infinity
    case "string":
      return isPositive ? "Infinity" : "-Infinity";
    case "original":
    default:
      return str;
  }
}

// node_modules/fast-xml-parser/src/ignoreAttributes.js
function getIgnoreAttributesFn(ignoreAttributes) {
  if (typeof ignoreAttributes === "function") {
    return ignoreAttributes;
  }
  if (Array.isArray(ignoreAttributes)) {
    return (attrName) => {
      for (const pattern of ignoreAttributes) {
        if (typeof pattern === "string" && attrName === pattern) {
          return true;
        }
        if (pattern instanceof RegExp && pattern.test(attrName)) {
          return true;
        }
      }
    };
  }
  return () => false;
}

// node_modules/path-expression-matcher/src/Expression.js
var Expression = class {
  /**
   * Create a new Expression
   * @param {string} pattern - Pattern string (e.g., "root.users.user", "..user[id]")
   * @param {Object} options - Configuration options
   * @param {string} options.separator - Path separator (default: '.')
   */
  constructor(pattern, options = {}, data) {
    this.pattern = pattern;
    this.separator = options.separator || ".";
    this.segments = this._parse(pattern);
    this.data = data;
    this._hasDeepWildcard = this.segments.some((seg) => seg.type === "deep-wildcard");
    this._hasAttributeCondition = this.segments.some((seg) => seg.attrName !== void 0);
    this._hasPositionSelector = this.segments.some((seg) => seg.position !== void 0);
  }
  /**
   * Parse pattern string into segments
   * @private
   * @param {string} pattern - Pattern to parse
   * @returns {Array} Array of segment objects
   */
  _parse(pattern) {
    const segments = [];
    let i = 0;
    let currentPart = "";
    while (i < pattern.length) {
      if (pattern[i] === this.separator) {
        if (i + 1 < pattern.length && pattern[i + 1] === this.separator) {
          if (currentPart.trim()) {
            segments.push(this._parseSegment(currentPart.trim()));
            currentPart = "";
          }
          segments.push({ type: "deep-wildcard" });
          i += 2;
        } else {
          if (currentPart.trim()) {
            segments.push(this._parseSegment(currentPart.trim()));
          }
          currentPart = "";
          i++;
        }
      } else {
        currentPart += pattern[i];
        i++;
      }
    }
    if (currentPart.trim()) {
      segments.push(this._parseSegment(currentPart.trim()));
    }
    return segments;
  }
  /**
   * Parse a single segment
   * @private
   * @param {string} part - Segment string (e.g., "user", "ns::user", "user[id]", "ns::user:first")
   * @returns {Object} Segment object
   */
  _parseSegment(part) {
    const segment = { type: "tag" };
    let bracketContent = null;
    let withoutBrackets = part;
    const bracketMatch = part.match(/^([^\[]+)(\[[^\]]*\])(.*)$/);
    if (bracketMatch) {
      withoutBrackets = bracketMatch[1] + bracketMatch[3];
      if (bracketMatch[2]) {
        const content = bracketMatch[2].slice(1, -1);
        if (content) {
          bracketContent = content;
        }
      }
    }
    let namespace = void 0;
    let tagAndPosition = withoutBrackets;
    if (withoutBrackets.includes("::")) {
      const nsIndex = withoutBrackets.indexOf("::");
      namespace = withoutBrackets.substring(0, nsIndex).trim();
      tagAndPosition = withoutBrackets.substring(nsIndex + 2).trim();
      if (!namespace) {
        throw new Error(`Invalid namespace in pattern: ${part}`);
      }
    }
    let tag = void 0;
    let positionMatch = null;
    if (tagAndPosition.includes(":")) {
      const colonIndex = tagAndPosition.lastIndexOf(":");
      const tagPart = tagAndPosition.substring(0, colonIndex).trim();
      const posPart = tagAndPosition.substring(colonIndex + 1).trim();
      const isPositionKeyword = ["first", "last", "odd", "even"].includes(posPart) || /^nth\(\d+\)$/.test(posPart);
      if (isPositionKeyword) {
        tag = tagPart;
        positionMatch = posPart;
      } else {
        tag = tagAndPosition;
      }
    } else {
      tag = tagAndPosition;
    }
    if (!tag) {
      throw new Error(`Invalid segment pattern: ${part}`);
    }
    segment.tag = tag;
    if (namespace) {
      segment.namespace = namespace;
    }
    if (bracketContent) {
      if (bracketContent.includes("=")) {
        const eqIndex = bracketContent.indexOf("=");
        segment.attrName = bracketContent.substring(0, eqIndex).trim();
        segment.attrValue = bracketContent.substring(eqIndex + 1).trim();
      } else {
        segment.attrName = bracketContent.trim();
      }
    }
    if (positionMatch) {
      const nthMatch = positionMatch.match(/^nth\((\d+)\)$/);
      if (nthMatch) {
        segment.position = "nth";
        segment.positionValue = parseInt(nthMatch[1], 10);
      } else {
        segment.position = positionMatch;
      }
    }
    return segment;
  }
  /**
   * Get the number of segments
   * @returns {number}
   */
  get length() {
    return this.segments.length;
  }
  /**
   * Check if expression contains deep wildcard
   * @returns {boolean}
   */
  hasDeepWildcard() {
    return this._hasDeepWildcard;
  }
  /**
   * Check if expression has attribute conditions
   * @returns {boolean}
   */
  hasAttributeCondition() {
    return this._hasAttributeCondition;
  }
  /**
   * Check if expression has position selectors
   * @returns {boolean}
   */
  hasPositionSelector() {
    return this._hasPositionSelector;
  }
  /**
   * Get string representation
   * @returns {string}
   */
  toString() {
    return this.pattern;
  }
};

// node_modules/path-expression-matcher/src/ExpressionSet.js
var ExpressionSet = class {
  constructor() {
    this._byDepthAndTag = /* @__PURE__ */ new Map();
    this._wildcardByDepth = /* @__PURE__ */ new Map();
    this._deepWildcards = [];
    this._deepByTerminalTag = /* @__PURE__ */ new Map();
    this._patterns = /* @__PURE__ */ new Set();
    this._sealed = false;
  }
  /**
   * Add an Expression to the set.
   * Duplicate patterns (same pattern string) are silently ignored.
   *
   * @param {import('./Expression.js').default} expression - A pre-constructed Expression instance
   * @returns {this} for chaining
   * @throws {TypeError} if called after seal()
   *
   * @example
   * set.add(new Expression('root.users.user'));
   * set.add(new Expression('..script'));
   */
  add(expression) {
    if (this._sealed) {
      throw new TypeError(
        "ExpressionSet is sealed. Create a new ExpressionSet to add more expressions."
      );
    }
    if (this._patterns.has(expression.pattern)) return this;
    this._patterns.add(expression.pattern);
    if (expression.hasDeepWildcard()) {
      const lastSeg2 = expression.segments[expression.segments.length - 1];
      if (lastSeg2 && lastSeg2.type !== "deep-wildcard" && lastSeg2.tag !== "*") {
        const tag2 = lastSeg2.tag;
        if (!this._deepByTerminalTag.has(tag2)) this._deepByTerminalTag.set(tag2, []);
        this._deepByTerminalTag.get(tag2).push(expression);
      } else {
        this._deepWildcards.push(expression);
      }
      return this;
    }
    const depth = expression.length;
    const lastSeg = expression.segments[expression.segments.length - 1];
    const tag = lastSeg?.tag;
    if (!tag || tag === "*") {
      if (!this._wildcardByDepth.has(depth)) this._wildcardByDepth.set(depth, []);
      this._wildcardByDepth.get(depth).push(expression);
    } else {
      const key = `${depth}:${tag}`;
      if (!this._byDepthAndTag.has(key)) this._byDepthAndTag.set(key, []);
      this._byDepthAndTag.get(key).push(expression);
    }
    return this;
  }
  /**
   * Add multiple expressions at once.
   *
   * @param {import('./Expression.js').default[]} expressions - Array of Expression instances
   * @returns {this} for chaining
   *
   * @example
   * set.addAll([
   *   new Expression('root.users.user'),
   *   new Expression('root.config.setting'),
   * ]);
   */
  addAll(expressions) {
    for (const expr of expressions) this.add(expr);
    return this;
  }
  /**
   * Check whether a pattern string is already present in the set.
   *
   * @param {import('./Expression.js').default} expression
   * @returns {boolean}
   */
  has(expression) {
    return this._patterns.has(expression.pattern);
  }
  /**
   * Number of expressions in the set.
   * @type {number}
   */
  get size() {
    return this._patterns.size;
  }
  /**
   * Seal the set against further modifications.
   * Useful to prevent accidental mutations after config is built.
   * Calling add() or addAll() on a sealed set throws a TypeError.
   *
   * @returns {this}
   */
  seal() {
    this._sealed = true;
    return this;
  }
  /**
   * Whether the set has been sealed.
   * @type {boolean}
   */
  get isSealed() {
    return this._sealed;
  }
  /**
   * Test whether the matcher's current path matches any expression in the set.
   *
   * Evaluation order (cheapest → most expensive):
   *  1. Exact depth + tag bucket  — O(1) lookup, typically 0–2 expressions
   *  2. Depth-only wildcard bucket — O(1) lookup, rare
   *  3. Deep-wildcard list         — always checked, but usually small
   *
   * @param {import('./Matcher.js').default} matcher - Matcher instance (or readOnly view)
   * @returns {boolean} true if any expression matches the current path
   *
   * @example
   * if (stopNodes.matchesAny(matcher)) {
   *   // handle stop node
   * }
   */
  matchesAny(matcher) {
    return this.findMatch(matcher) !== null;
  }
  /**
  * Find and return the first Expression that matches the matcher's current path.
  *
  * Uses the same evaluation order as matchesAny (cheapest → most expensive):
  *  1. Exact depth + tag bucket
  *  2. Depth-only wildcard bucket
  *  3. Deep-wildcard list
  *
  * @param {import('./Matcher.js').default} matcher - Matcher instance (or readOnly view)
  * @returns {import('./Expression.js').default | null} the first matching Expression, or null
  *
  * @example
  * const expr = stopNodes.findMatch(matcher);
  * if (expr) {
  *   // access expr.config, expr.pattern, etc.
  * }
  */
  findMatch(matcher) {
    const depth = matcher.getDepth();
    const tag = matcher.getCurrentTag();
    const exactKey = `${depth}:${tag}`;
    const exactBucket = this._byDepthAndTag.get(exactKey);
    if (exactBucket) {
      for (let i = 0; i < exactBucket.length; i++) {
        if (matcher.matches(exactBucket[i])) return exactBucket[i];
      }
    }
    const wildcardBucket = this._wildcardByDepth.get(depth);
    if (wildcardBucket) {
      for (let i = 0; i < wildcardBucket.length; i++) {
        if (matcher.matches(wildcardBucket[i])) return wildcardBucket[i];
      }
    }
    const deepBucket = this._deepByTerminalTag.get(tag);
    if (deepBucket) {
      for (let i = 0; i < deepBucket.length; i++) {
        if (matcher.matches(deepBucket[i])) return deepBucket[i];
      }
    }
    for (let i = 0; i < this._deepWildcards.length; i++) {
      if (matcher.matches(this._deepWildcards[i])) return this._deepWildcards[i];
    }
    return null;
  }
};

// node_modules/path-expression-matcher/src/Matcher.js
var MatcherView = class {
  /**
   * @param {Matcher} matcher - The parent Matcher instance to read from.
   */
  constructor(matcher) {
    this._matcher = matcher;
  }
  /**
   * Get the path separator used by the parent matcher.
   * @returns {string}
   */
  get separator() {
    return this._matcher.separator;
  }
  /**
   * Get current tag name.
   * @returns {string|undefined}
   */
  getCurrentTag() {
    const path = this._matcher.path;
    return path.length > 0 ? path[path.length - 1].tag : void 0;
  }
  /**
   * Get current namespace.
   * @returns {string|undefined}
   */
  getCurrentNamespace() {
    const path = this._matcher.path;
    return path.length > 0 ? path[path.length - 1].namespace : void 0;
  }
  /**
   * Get current node's attribute value.
   * @param {string} attrName
   * @returns {*}
   */
  getAttrValue(attrName) {
    const path = this._matcher.path;
    if (path.length === 0) return void 0;
    return path[path.length - 1].values?.[attrName];
  }
  /**
   * Check if current node has an attribute.
   * @param {string} attrName
   * @returns {boolean}
   */
  hasAttr(attrName) {
    const path = this._matcher.path;
    if (path.length === 0) return false;
    const current = path[path.length - 1];
    return current.values !== void 0 && attrName in current.values;
  }
  /**
   * Get the value of a "kept" attribute from the nearest ancestor (or
   * current node) that declared it via `push(tag, attrs, ns, { keep: [...] })`.
   * @param {string} attrName
   * @returns {*}
   */
  getAnyParentAttr(attrName) {
    return this._matcher.getAnyParentAttr(attrName);
  }
  /**
   * Check whether any ancestor (or the current node) kept the given
   * attribute via `push(tag, attrs, ns, { keep: [...] })`.
   * @param {string} attrName
   * @returns {boolean}
   */
  hasAnyParentAttr(attrName) {
    return this._matcher.hasAnyParentAttr(attrName);
  }
  /**
   * Get current node's sibling position (child index in parent).
   * @returns {number}
   */
  getPosition() {
    const path = this._matcher.path;
    if (path.length === 0) return -1;
    return path[path.length - 1].position ?? 0;
  }
  /**
   * Get current node's repeat counter (occurrence count of this tag name).
   * @returns {number}
   */
  getCounter() {
    const path = this._matcher.path;
    if (path.length === 0) return -1;
    return path[path.length - 1].counter ?? 0;
  }
  /**
   * Get current node's sibling index (alias for getPosition).
   * @returns {number}
   * @deprecated Use getPosition() or getCounter() instead
   */
  getIndex() {
    return this.getPosition();
  }
  /**
   * Get current path depth.
   * @returns {number}
   */
  getDepth() {
    return this._matcher.path.length;
  }
  /**
   * Get path as string.
   * @param {string} [separator] - Optional separator (uses default if not provided)
   * @param {boolean} [includeNamespace=true]
   * @returns {string}
   */
  toString(separator, includeNamespace = true) {
    return this._matcher.toString(separator, includeNamespace);
  }
  /**
   * Get path as array of tag names.
   * @returns {string[]}
   */
  toArray() {
    return this._matcher.path.map((n) => n.tag);
  }
  /**
   * Match current path against an Expression.
   * @param {Expression} expression
   * @returns {boolean}
   */
  matches(expression) {
    return this._matcher.matches(expression);
  }
  /**
   * Match any expression in the given set against the current path.
   * @param {ExpressionSet} exprSet
   * @returns {boolean}
   */
  matchesAny(exprSet) {
    return exprSet.matchesAny(this._matcher);
  }
};
var Matcher = class {
  /**
   * Create a new Matcher.
   * @param {Object} [options={}]
   * @param {string} [options.separator='.'] - Default path separator
   */
  constructor(options = {}) {
    this.separator = options.separator || ".";
    this.path = [];
    this.siblingStacks = [];
    this._pathStringCache = null;
    this._view = new MatcherView(this);
    this._keptAttrs = [];
  }
  /**
   * Push a new tag onto the path.
   * @param {string} tagName
   * @param {Object|null} [attrValues=null]
   * @param {string|null} [namespace=null]
   * @param {Object|null} [options=null]
   * @param {string[]} [options.keep] - Names of attributes (from attrValues)
   */
  push(tagName, attrValues = null, namespace = null, options = null) {
    this._pathStringCache = null;
    if (this.path.length > 0) {
      this.path[this.path.length - 1].values = void 0;
    }
    const currentLevel = this.path.length;
    let level = this.siblingStacks[currentLevel];
    if (!level) {
      level = { counts: /* @__PURE__ */ new Map(), total: 0 };
      this.siblingStacks[currentLevel] = level;
    }
    const siblingKey = namespace ? `${namespace}:${tagName}` : tagName;
    const counter = level.counts.get(siblingKey) || 0;
    const position = level.total;
    level.counts.set(siblingKey, counter + 1);
    level.total++;
    const node = {
      tag: tagName,
      position,
      counter
    };
    if (namespace !== null && namespace !== void 0) {
      node.namespace = namespace;
    }
    if (attrValues !== null && attrValues !== void 0) {
      node.values = attrValues;
    }
    this.path.push(node);
    const depth = this.path.length;
    const keep = options !== null ? options.keep : null;
    if (keep !== null && keep !== void 0 && keep.length > 0 && attrValues) {
      for (let i = 0; i < keep.length; i++) {
        const name = keep[i];
        if (attrValues[name] !== void 0) {
          this._keptAttrs.push({ depth, name, value: attrValues[name] });
        }
      }
    }
  }
  /**
   * Pop the last tag from the path.
   * @returns {Object|undefined} The popped node
   */
  pop() {
    if (this.path.length === 0) return void 0;
    this._pathStringCache = null;
    const node = this.path.pop();
    if (this.siblingStacks.length > this.path.length + 1) {
      this.siblingStacks.length = this.path.length + 1;
    }
    const poppedDepth = this.path.length + 1;
    while (this._keptAttrs.length > 0 && this._keptAttrs[this._keptAttrs.length - 1].depth >= poppedDepth) {
      this._keptAttrs.pop();
    }
    return node;
  }
  /**
   * Update current node's attribute values.
   * Useful when attributes are parsed after push.
   * @param {Object} attrValues
   */
  updateCurrent(attrValues) {
    if (this.path.length > 0) {
      const current = this.path[this.path.length - 1];
      if (attrValues !== null && attrValues !== void 0) {
        current.values = attrValues;
      }
    }
  }
  /**
   * Get current tag name.
   * @returns {string|undefined}
   */
  getCurrentTag() {
    return this.path.length > 0 ? this.path[this.path.length - 1].tag : void 0;
  }
  /**
   * Get current namespace.
   * @returns {string|undefined}
   */
  getCurrentNamespace() {
    return this.path.length > 0 ? this.path[this.path.length - 1].namespace : void 0;
  }
  /**
   * Get current node's attribute value.
   * @param {string} attrName
   * @returns {*}
   */
  getAttrValue(attrName) {
    if (this.path.length === 0) return void 0;
    return this.path[this.path.length - 1].values?.[attrName];
  }
  /**
   * Check if current node has an attribute.
   * @param {string} attrName
   * @returns {boolean}
   */
  hasAttr(attrName) {
    if (this.path.length === 0) return false;
    const current = this.path[this.path.length - 1];
    return current.values !== void 0 && attrName in current.values;
  }
  /**
   * Get the value of a "kept" attribute from the nearest ancestor (or
   * current node) that declared it via `push(tag, attrs, ns, { keep: [...] })`.
   * Unlike getAttrValue(), this works regardless of how deep the path has
   * gone since the attribute was pushed — but only for attribute names that
   * were explicitly marked with `keep` at push time. Cost is proportional to
   * the number of currently-kept attributes (typically 0-3), not path depth.
   * @param {string} attrName
   * @returns {*} the value, or undefined if no ancestor kept this attribute
   */
  getAnyParentAttr(attrName) {
    const kept = this._keptAttrs;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i].name === attrName) return kept[i].value;
    }
    return void 0;
  }
  /**
   * Check whether any ancestor (or the current node) kept the given
   * attribute via `push(tag, attrs, ns, { keep: [...] })`.
   * @param {string} attrName
   * @returns {boolean}
   */
  hasAnyParentAttr(attrName) {
    const kept = this._keptAttrs;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i].name === attrName) return true;
    }
    return false;
  }
  /**
   * Get current node's sibling position (child index in parent).
   * @returns {number}
   */
  getPosition() {
    if (this.path.length === 0) return -1;
    return this.path[this.path.length - 1].position ?? 0;
  }
  /**
   * Get current node's repeat counter (occurrence count of this tag name).
   * @returns {number}
   */
  getCounter() {
    if (this.path.length === 0) return -1;
    return this.path[this.path.length - 1].counter ?? 0;
  }
  /**
   * Get current node's sibling index (alias for getPosition).
   * @returns {number}
   * @deprecated Use getPosition() or getCounter() instead
   */
  getIndex() {
    return this.getPosition();
  }
  /**
   * Get current path depth.
   * @returns {number}
   */
  getDepth() {
    return this.path.length;
  }
  /**
   * Get path as string.
   * @param {string} [separator] - Optional separator (uses default if not provided)
   * @param {boolean} [includeNamespace=true]
   * @returns {string}
   */
  toString(separator, includeNamespace = true) {
    const sep2 = separator || this.separator;
    const isDefault = sep2 === this.separator && includeNamespace === true;
    if (isDefault) {
      if (this._pathStringCache !== null) {
        return this._pathStringCache;
      }
      const result = this.path.map(
        (n) => n.namespace ? `${n.namespace}:${n.tag}` : n.tag
      ).join(sep2);
      this._pathStringCache = result;
      return result;
    }
    return this.path.map(
      (n) => includeNamespace && n.namespace ? `${n.namespace}:${n.tag}` : n.tag
    ).join(sep2);
  }
  /**
   * Get path as array of tag names.
   * @returns {string[]}
   */
  toArray() {
    return this.path.map((n) => n.tag);
  }
  /**
   * Reset the path to empty.
   */
  reset() {
    this._pathStringCache = null;
    this.path = [];
    this.siblingStacks = [];
    this._keptAttrs = [];
  }
  /**
   * Match current path against an Expression.
   * @param {Expression} expression
   * @returns {boolean}
   */
  matches(expression) {
    const segments = expression.segments;
    if (segments.length === 0) {
      return false;
    }
    if (expression.hasDeepWildcard()) {
      return this._matchWithDeepWildcard(segments);
    }
    return this._matchSimple(segments);
  }
  /**
   * @private
   */
  _matchSimple(segments) {
    if (this.path.length !== segments.length) {
      return false;
    }
    for (let i = 0; i < segments.length; i++) {
      if (!this._matchSegment(segments[i], this.path[i], i === this.path.length - 1)) {
        return false;
      }
    }
    return true;
  }
  /**
   * @private
   */
  _matchWithDeepWildcard(segments) {
    let pathIdx = this.path.length - 1;
    let segIdx = segments.length - 1;
    while (segIdx >= 0 && pathIdx >= 0) {
      const segment = segments[segIdx];
      if (segment.type === "deep-wildcard") {
        segIdx--;
        if (segIdx < 0) {
          return true;
        }
        const nextSeg = segments[segIdx];
        let found = false;
        for (let i = pathIdx; i >= 0; i--) {
          if (this._matchSegment(nextSeg, this.path[i], i === this.path.length - 1)) {
            pathIdx = i - 1;
            segIdx--;
            found = true;
            break;
          }
        }
        if (!found) {
          return false;
        }
      } else {
        if (!this._matchSegment(segment, this.path[pathIdx], pathIdx === this.path.length - 1)) {
          return false;
        }
        pathIdx--;
        segIdx--;
      }
    }
    return segIdx < 0;
  }
  /**
   * @private
   */
  _matchSegment(segment, node, isCurrentNode) {
    if (segment.tag !== "*" && segment.tag !== node.tag) {
      return false;
    }
    if (segment.namespace !== void 0) {
      if (segment.namespace !== "*" && segment.namespace !== node.namespace) {
        return false;
      }
    }
    if (segment.attrName !== void 0) {
      if (!isCurrentNode) {
        return false;
      }
      if (!node.values || !(segment.attrName in node.values)) {
        return false;
      }
      if (segment.attrValue !== void 0) {
        if (String(node.values[segment.attrName]) !== String(segment.attrValue)) {
          return false;
        }
      }
    }
    if (segment.position !== void 0) {
      if (!isCurrentNode) {
        return false;
      }
      const counter = node.counter ?? 0;
      if (segment.position === "first" && counter !== 0) {
        return false;
      } else if (segment.position === "odd" && counter % 2 !== 1) {
        return false;
      } else if (segment.position === "even" && counter % 2 !== 0) {
        return false;
      } else if (segment.position === "nth" && counter !== segment.positionValue) {
        return false;
      }
    }
    return true;
  }
  /**
   * Match any expression in the given set against the current path.
   * @param {ExpressionSet} exprSet
   * @returns {boolean}
   */
  matchesAny(exprSet) {
    return exprSet.matchesAny(this);
  }
  /**
   * Create a snapshot of current state.
   * @returns {Object}
   */
  snapshot() {
    return {
      path: this.path.map((node) => ({ ...node })),
      siblingStacks: this.siblingStacks.map((level) => level ? { counts: new Map(level.counts), total: level.total } : level),
      keptAttrs: this._keptAttrs.map((entry) => ({ ...entry }))
    };
  }
  /**
   * Restore state from snapshot.
   * @param {Object} snapshot
   */
  restore(snapshot) {
    this._pathStringCache = null;
    this.path = snapshot.path.map((node) => ({ ...node }));
    this.siblingStacks = snapshot.siblingStacks.map((level) => level ? { counts: new Map(level.counts), total: level.total } : level);
    this._keptAttrs = (snapshot.keptAttrs || []).map((entry) => ({ ...entry }));
  }
  /**
   * Return the read-only {@link MatcherView} for this matcher.
   *
   * The same instance is returned on every call — no allocation occurs.
   * It always reflects the current parser state and is safe to pass to
   * user callbacks without risk of accidental mutation.
   *
   * @returns {MatcherView}
   *
   * @example
   * const view = matcher.readOnly();
   * // pass view to callbacks — it stays in sync automatically
   * view.matches(expr);       // ✓
   * view.getCurrentTag();     // ✓
   * // view.push(...)         // ✗ method does not exist — caught by TypeScript
   */
  readOnly() {
    return this._view;
  }
};

// node_modules/is-unsafe/src/contexts/html.js
var HTML_PATTERNS = [
  {
    id: "html-script-open",
    description: "<script opening tag",
    pattern: /<script[\s>/]/i
  },
  {
    id: "html-script-close",
    description: "<\/script closing tag",
    pattern: /<\/script[\s>]/i
  },
  {
    id: "html-javascript-protocol",
    description: "javascript: URI scheme (with optional whitespace/encoding)",
    // Handles j&#x61;vascript:, j\u0061vascript:, and whitespace variants
    pattern: /j[\t\n\r ]*a[\t\n\r ]*v[\t\n\r ]*a[\t\n\r ]*s[\t\n\r ]*c[\t\n\r ]*r[\t\n\r ]*i[\t\n\r ]*p[\t\n\r ]*t[\t\n\r ]*:/i
  },
  {
    id: "html-vbscript-protocol",
    description: "vbscript: URI scheme",
    pattern: /vbscript[\t\n\r ]*:/i
  },
  {
    id: "html-data-html",
    description: "data:text/html URI \u2014 can execute scripts in browsers",
    pattern: /data[\t\n\r ]*:[\t\n\r ]*text\/html/i
  },
  {
    id: "html-data-xhtml",
    description: "data:application/xhtml+xml URI",
    pattern: /data[\t\n\r ]*:[\t\n\r ]*application\/xhtml/i
  },
  {
    id: "html-data-svg",
    description: "data:image/svg+xml URI \u2014 can execute scripts",
    pattern: /data[\t\n\r ]*:[\t\n\r ]*image\/svg\+xml/i
  },
  {
    id: "html-inline-event-handler",
    description: "Inline event handler attributes: onclick=, onerror=, onload=, etc.",
    // \bon ensures we match a word boundary so "phonetic=" is not caught
    pattern: /\bon\w{1,30}\s*=/i
  },
  {
    id: "html-entity-obfuscated-script",
    description: "HTML-entity-encoded <script (e.g. &#x3C;script or &lt;script)",
    // Entities include optional trailing semicolon: &#x3C; or &#x3C (both valid in HTML5)
    pattern: /(?:&#x0*3[Cc];?|&#0*60;?|&lt;)\s*script/i
  },
  {
    id: "html-entity-obfuscated-javascript",
    description: 'HTML-entity-encoded javascript: (partial \u2014 catches common &#106; or &#x6a; for "j")',
    pattern: /(?:&#x0*6[Aa];?|&#0*106;?)\s*(?:&#x0*61;?|a)[\s\S]{0,80}script\s*:/i
  },
  {
    id: "html-style-expression",
    description: "CSS expression() \u2014 IE-era code execution in style attributes",
    pattern: /style[\s\S]{0,20}expression\s*\(/i
  },
  {
    id: "html-object-embed",
    description: "<object or <embed tags that can load active content",
    pattern: /<(?:object|embed)[\s>/]/i
  },
  {
    id: "html-base-tag",
    description: "<base href= \u2014 can hijack all relative URLs on a page",
    pattern: /<base[\s>]/i
  },
  {
    id: "html-meta-refresh",
    description: '<meta http-equiv="refresh" \u2014 can redirect users',
    pattern: /<meta[\s\S]{0,40}http-equiv[\s\S]{0,20}refresh/i
  },
  {
    id: "html-srcdoc",
    description: "srcdoc= attribute on iframes \u2014 embeds HTML that can run scripts",
    pattern: /srcdoc\s*=/i
  },
  {
    id: "html-iframe",
    description: "<iframe tag",
    pattern: /<iframe[\s>/]/i
  },
  {
    id: "html-form",
    description: "<form tag \u2014 can be used for phishing / credential harvesting injection",
    pattern: /<form[\s>/]/i
  }
];
var html_default = HTML_PATTERNS;

// node_modules/is-unsafe/src/contexts/xml.js
var XML_PATTERNS = [
  {
    id: "xml-cdata-injection",
    description: "CDATA section injection: <![CDATA[ breaks out of text node context",
    pattern: /<!\[CDATA\[/i
  },
  {
    id: "xml-cdata-close",
    description: "CDATA close sequence: ]]> can terminate an enclosing CDATA section",
    pattern: /\]\]>/
  },
  {
    id: "xml-processing-instruction",
    description: "XML processing instruction: <?xml-stylesheet or <?php etc.",
    pattern: /<\?(?:xml[\- ]|php|asp)/i
  },
  {
    id: "xml-doctype-injection",
    description: "DOCTYPE declaration embedded in content \u2014 can define entities",
    // Match <!DOCTYPE followed by end-of-string, whitespace, or [ (internal subset)
    pattern: /<!DOCTYPE(?:[\s[]|$)/i
  },
  {
    id: "xml-entity-system",
    description: "SYSTEM keyword \u2014 used in external entity declarations (XXE)",
    pattern: /\bSYSTEM\s+["']/i
  },
  {
    id: "xml-entity-public",
    description: "PUBLIC keyword \u2014 used in external entity declarations (XXE)",
    pattern: /\bPUBLIC\s+["']/i
  },
  {
    id: "xml-entity-declaration",
    description: "<!ENTITY declaration \u2014 defines entities, potential XXE or entity expansion",
    pattern: /<!ENTITY[\s%]/i
  },
  {
    id: "xml-billion-laughs",
    description: "Entity reference chaining / billion laughs: repeated &eX; style references",
    // Heuristic: 3+ consecutive entity refs suggests expansion attack
    pattern: /(?:&\w{1,20};){3,}/
  },
  {
    id: "xml-namespace-confusion",
    description: "xmlns: attribute injection \u2014 can redefine namespaces to confuse parsers",
    // pattern: /\bxmlns\s*(?::\w{1,40})?\s*=/i,
    pattern: /\bxmlns(?::\w{1,40})?\s*=/i
  },
  {
    id: "xml-comment-injection",
    description: "<!-- comment injection \u2014 can hide content from some parsers",
    pattern: /<!--/
  },
  {
    id: "xml-comment-close",
    description: "--> closes an enclosing XML comment",
    pattern: /-->/
  },
  {
    id: "xml-pi-close",
    description: "?> closes an enclosing processing instruction",
    pattern: /\?>/
  }
];
var xml_default = XML_PATTERNS;

// node_modules/is-unsafe/src/contexts/svg.js
var SVG_PATTERNS = [
  {
    id: "svg-script-element",
    description: "<script element inside SVG executes JavaScript",
    pattern: /<script[\s>/]/i
  },
  {
    id: "svg-xlink-href-javascript",
    description: "xlink:href with javascript: \u2014 classic SVG XSS via <a> or <use>",
    pattern: /xlink\s*:\s*href\s*=\s*["']?\s*javascript\s*:/i
  },
  {
    id: "svg-href-javascript",
    description: "href= with javascript: in SVG context (<a>, <animate>, etc.)",
    pattern: /href\s*=\s*["']?\s*javascript\s*:/i
  },
  {
    id: "svg-foreignobject",
    description: "<foreignObject embeds HTML inside SVG \u2014 can execute scripts",
    pattern: /<foreignObject[\s>/]/i
  },
  {
    id: "svg-use-external",
    description: "<use xlink:href or href pointing to external resource (non-fragment URL)",
    // Match <use with href= where the value starts with a non-# character (external URL)
    // [\"'][^#] catches quoted values not starting with #; [^\"'#\s>] catches unquoted
    pattern: /<use[\s\S]{0,60}(?:xlink\s*:\s*)?href\s*=\s*(?:["'][^#]|[^"'#\s>])/i
  },
  {
    id: "svg-animate-href",
    description: '<animate attributeName="href" \u2014 can dynamically change href to javascript:',
    pattern: /<animate[\s\S]{0,80}attributeName\s*=\s*["'][\s]*href["']/i
  },
  {
    id: "svg-animate-xlinkhref",
    description: '<animate attributeName="xlink:href"',
    pattern: /<animate[\s\S]{0,80}attributeName\s*=\s*["'][\s]*xlink\s*:\s*href["']/i
  },
  {
    id: "svg-set-javascript",
    description: '<set to="javascript:..." \u2014 sets an attribute to a javascript: URI',
    pattern: /<set[\s\S]{0,80}to\s*=\s*["']?\s*javascript\s*:/i
  },
  {
    id: "svg-event-handler",
    description: "SVG-specific event handler attributes: onload=, onerror=, onactivate=, etc.",
    pattern: /\bon(?:load|error|activate|begin|end|repeat|focus|blur|click|mouse\w{1,20}|key\w{1,20})\s*=/i
  },
  {
    id: "svg-handler-generic",
    description: "Generic on* handler catch-all for SVG attributes",
    pattern: /\bon\w{1,30}\s*=/i
  },
  {
    id: "svg-filter-feimage",
    description: "<feImage href= \u2014 filter primitive that can load external resources",
    pattern: /<feImage[\s\S]{0,80}(?:xlink\s*:\s*)?href\s*=/i
  },
  {
    id: "svg-image-external",
    description: "<image xlink:href with http/https or javascript protocol",
    pattern: /<image[\s\S]{0,80}(?:xlink\s*:\s*)?href\s*=\s*["']?\s*(?:https?|javascript)\s*:/i
  },
  {
    id: "svg-style-javascript",
    description: "style= attribute containing javascript: (e.g. background:url(javascript:...))",
    pattern: /style\s*=[\s\S]{0,60}javascript\s*:/i
  }
];
var svg_default = SVG_PATTERNS;

// node_modules/is-unsafe/src/contexts/sql.js
var SQL_PATTERNS = [
  {
    id: "sql-block-comment-open",
    description: "SQL block comment open: /* ... */ \u2014 unusual in legitimate user text",
    pattern: /\/\*/
  },
  {
    id: "sql-union-select",
    description: "UNION SELECT \u2014 most common SQL injection aggregation attack",
    pattern: /\bUNION\s{1,20}(?:ALL\s{1,20})?SELECT\b/i
  },
  {
    id: "sql-drop-table",
    description: "DROP TABLE \u2014 destructive DDL injection",
    pattern: /\bDROP\s{1,20}TABLE\b/i
  },
  {
    id: "sql-drop-database",
    description: "DROP DATABASE \u2014 destructive DDL injection",
    pattern: /\bDROP\s{1,20}DATABASE\b/i
  },
  {
    id: "sql-insert-into",
    description: "INSERT INTO \u2014 data injection",
    pattern: /\bINSERT\s{1,20}INTO\b/i
  },
  {
    id: "sql-delete-from",
    description: "DELETE FROM \u2014 data deletion injection",
    pattern: /\bDELETE\s{1,20}FROM\b/i
  },
  {
    id: "sql-update-set",
    description: "UPDATE ... SET \u2014 data modification injection",
    // Allows arbitrary content between UPDATE and SET (table name, alias, etc.)
    pattern: /\bUPDATE\b[\s\S]{1,60}\bSET\b/i
  },
  {
    id: "sql-exec-xp",
    description: "EXEC xp_ \u2014 MSSQL extended stored procedure execution",
    pattern: /\bEXEC(?:UTE)?\s{1,20}xp_/i
  },
  {
    id: "sql-tautology-string",
    description: `Classic string tautology: ' OR '1'='1 or " OR "1"="1"`,
    // Last quote is optional — injection may truncate it: ' OR '1'='1--
    pattern: /'\s{0,10}OR\s{0,10}'[^']{0,20}'\s*=\s*'[^']{0,20}/i
  },
  {
    id: "sql-tautology-numeric",
    description: "Numeric tautology: OR 1=1",
    pattern: /\bOR\s{1,10}1\s*=\s*1\b/i
  },
  {
    id: "sql-always-true-zero",
    description: "Numeric tautology: OR 0=0",
    pattern: /\bOR\s{1,10}0\s*=\s*0\b/i
  },
  {
    id: "sql-sleep-benchmark",
    description: "Time-based blind injection: SLEEP() or BENCHMARK()",
    pattern: /\b(?:SLEEP|BENCHMARK)\s*\(/i
  },
  {
    id: "sql-waitfor-delay",
    description: "MSSQL time-based blind injection: WAITFOR DELAY",
    pattern: /\bWAITFOR\s{1,20}DELAY\b/i
  },
  {
    id: "sql-char-function",
    description: "CHAR() function \u2014 used to obfuscate injected strings",
    pattern: /\bCHAR\s*\(\s*\d{1,3}/i
  },
  {
    id: "sql-information-schema",
    description: "INFORMATION_SCHEMA \u2014 reconnaissance query for table/column enumeration",
    pattern: /\bINFORMATION_SCHEMA\b/i
  }
];
var sql_default = SQL_PATTERNS;

// node_modules/is-unsafe/src/contexts/shell.js
var SHELL_PATTERNS = [
  {
    id: "shell-path-traversal-unix",
    description: "Unix path traversal: ../  \u2014 climbing the directory tree",
    pattern: /\.\.\//
  },
  {
    id: "shell-path-traversal-windows",
    description: "Windows path traversal: ..\\ \u2014 climbing the directory tree",
    pattern: /\.\.\\/
  },
  {
    id: "shell-path-traversal-encoded",
    description: "URL-encoded path traversal: %2e%2e or %2f variants",
    pattern: /%2e%2e|%2f\.\.|\.\.%2f/i
  },
  {
    id: "shell-null-byte",
    description: "Null byte injection: \\x00 or %00 \u2014 truncates strings in C-backed functions",
    pattern: /\x00|%00/
  },
  {
    id: "shell-semicolon",
    description: "Semicolon command separator: cmd1; cmd2",
    pattern: /;/
  },
  {
    id: "shell-pipe",
    description: "Pipe operator: cmd1 | cmd2",
    pattern: /\|/
  },
  {
    id: "shell-and-operator",
    description: "AND operator: cmd1 && cmd2",
    pattern: /&&/
  },
  {
    id: "shell-or-operator",
    description: "OR operator: cmd1 || cmd2",
    pattern: /\|\|/
  },
  {
    id: "shell-backtick",
    description: "Backtick command substitution: `cmd`",
    pattern: /`/
  },
  {
    id: "shell-dollar-paren",
    description: "Dollar-paren command substitution: $(cmd)",
    pattern: /\$\(/
  },
  {
    id: "shell-dollar-brace",
    description: "Dollar-brace variable expansion: ${var} \u2014 can be abused for injection",
    pattern: /\$\{/
  },
  {
    id: "shell-redirect-out",
    description: "Output redirection: cmd > file or cmd >> file",
    pattern: />{1,2}/
  },
  {
    id: "shell-redirect-in",
    description: "Input redirection: cmd < file",
    pattern: /</
  },
  {
    id: "shell-newline-injection",
    description: "Newline injection: \\n or \\r \u2014 can inject new shell commands",
    pattern: /[\n\r]/
  },
  {
    id: "shell-glob-star",
    description: "Glob expansion: * or ? \u2014 can expand to unintended files",
    // Only flag when combined with path separators to reduce false positives
    pattern: /[/\\][*?]/
  },
  {
    id: "shell-absolute-root",
    description: "Absolute root path injection: string starting with / or \\ (Windows UNC)",
    pattern: /^(?:\/|\\\\)/
  },
  {
    id: "shell-windows-drive",
    description: "Windows drive letter path injection: C:\\ or D:/",
    pattern: /^[a-zA-Z]:[/\\]/
  },
  {
    id: "shell-curl-wget",
    description: "curl/wget with URL or flags \u2014 can exfiltrate data or download payloads",
    // Require a URL scheme (http/https/ftp) or a flag (-) to reduce false positives
    // "curl is a tool" won't match; "curl http://..." or "curl -s ..." will
    pattern: /\b(?:curl|wget)\s+(?:https?:\/\/|ftp:\/\/|-)/i
  }
];
var shell_default = SHELL_PATTERNS;

// node_modules/is-unsafe/src/contexts/redos.js
var REDOS_PATTERNS = [
  {
    id: "redos-nested-quantifier-plus",
    description: "Nested + quantifier inside a group with outer quantifier: (a+)+, (.+b)*, etc.",
    // Matches any group containing a + quantifier, with an outer * or + — catches (a+)+, (.+b)*, etc.
    pattern: /\([^)]*\+[^)]*\)[+*]/
  },
  {
    id: "redos-nested-quantifier-star",
    description: "Nested * quantifier: (a*)* or (a*)+ \u2014 catastrophic backtracking",
    pattern: /\([^)]*\*[^)]*\)[*+]/
  },
  {
    id: "redos-nested-groups",
    description: "Doubly nested quantified groups: ((a+)+) \u2014 guaranteed catastrophic",
    pattern: /\(\([^)]{0,40}\)[+*]\)[+*]/
  },
  {
    id: "redos-alternation-overlap",
    description: "Overlapping alternation under quantifier: (a|a)+ \u2014 ambiguous NFA paths",
    // Detect repeated identical alternatives under a quantifier
    pattern: /\(([^|()]{1,20})\|(?:\1)(?:\|[^|()]{1,20}){0,5}\)[+*?]{1,2}/
  },
  {
    id: "redos-star-plus-concat",
    description: "(x*x)+ pattern \u2014 triggers super-linear backtracking",
    pattern: /\([^)]{0,10}\*[^)]{0,10}\)[+*]/
  },
  {
    id: "redos-dot-star-greedy",
    description: "(.*){n,} or (.+){n,} \u2014 repeated greedy dot quantifiers",
    pattern: /\(\.[*+]\)\{?\d/
  },
  {
    id: "redos-large-repetition",
    description: "Very large fixed or range repetition count {1000,} or {1000,n} \u2014 denial of service via backtracking",
    // Matches { followed by 4+ digits (≥1000), then optional ,digits }
    pattern: /\{\d{4,}(?:,\d*)?\}/
  },
  {
    id: "redos-catastrophic-alternation",
    description: "Long alternation with many similar branches \u2014 polynomial backtracking risk",
    // Heuristic: 10+ pipe-separated alternatives in a single group
    pattern: /\([^)]{0,200}(?:\|[^|)]{0,50}){9,}\)/
  }
];
var redos_default = REDOS_PATTERNS;

// node_modules/is-unsafe/src/contexts/nosql.js
var sep = `["'\\s]*:`;
var NOSQL_PATTERNS = [
  // ─── MongoDB $ operator injection ────────────────────────────────────────
  {
    id: "nosql-where-operator",
    description: "$where \u2014 executes arbitrary JavaScript server-side in MongoDB",
    pattern: new RegExp(`\\$where${sep}`, "i")
  },
  {
    id: "nosql-ne-operator",
    description: '$ne \u2014 "not equal" operator used to bypass equality checks',
    pattern: new RegExp(`\\$ne${sep}`, "i")
  },
  {
    id: "nosql-gt-operator",
    description: '$gt \u2014 "greater than" used to bypass password/value checks',
    pattern: new RegExp(`\\$gte?${sep}`, "i")
  },
  {
    id: "nosql-lt-operator",
    description: '$lt / $lte \u2014 "less than" bypass variants',
    pattern: new RegExp(`\\$lte?${sep}`, "i")
  },
  {
    id: "nosql-regex-operator",
    description: "$regex \u2014 can be used to extract data character by character (blind injection)",
    pattern: new RegExp(`\\$regex${sep}`, "i")
  },
  {
    id: "nosql-or-operator",
    description: "$or \u2014 logical OR; used to create always-true conditions",
    pattern: new RegExp(`\\$or${sep}\\s*\\[`, "i")
  },
  {
    id: "nosql-and-operator",
    description: "$and \u2014 logical AND operator injection",
    pattern: new RegExp(`\\$and${sep}\\s*\\[`, "i")
  },
  {
    id: "nosql-nor-operator",
    description: "$nor \u2014 logical NOR operator injection",
    pattern: new RegExp(`\\$nor${sep}\\s*\\[`, "i")
  },
  {
    id: "nosql-exists-operator",
    description: "$exists \u2014 can enumerate fields to determine schema",
    pattern: new RegExp(`\\$exists${sep}`, "i")
  },
  {
    id: "nosql-in-operator",
    description: "$in \u2014 matches any value in a list; can enumerate values",
    pattern: new RegExp(`\\$in${sep}\\s*\\[`, "i")
  },
  {
    id: "nosql-expr-operator",
    description: "$expr \u2014 allows aggregation expressions in queries (MongoDB 3.6+)",
    pattern: new RegExp(`\\$expr${sep}`, "i")
  },
  {
    id: "nosql-function-operator",
    description: "$function \u2014 executes arbitrary JavaScript in MongoDB 4.4+",
    pattern: new RegExp(`\\$function${sep}`, "i")
  },
  {
    id: "nosql-accumulator-operator",
    description: "$accumulator \u2014 custom aggregation with arbitrary JS execution",
    pattern: new RegExp(`\\$accumulator${sep}`, "i")
  },
  // ─── Prototype pollution ─────────────────────────────────────────────────
  {
    id: "nosql-proto-pollution",
    description: "__proto__ \u2014 prototype pollution via object key injection",
    pattern: /__proto__/
  },
  {
    id: "nosql-constructor-prototype",
    description: "constructor.prototype \u2014 alternative prototype pollution vector (dot notation or JSON key)",
    // Matches dot-notation (obj.constructor.prototype) and JSON key adjacency
    // ("constructor": {"prototype": ...})
    pattern: /constructor[\s"':.,{\[]*prototype/i
  },
  {
    id: "nosql-proto-bracket",
    description: '["__proto__"] \u2014 bracket-notation prototype pollution',
    pattern: /\[["']__proto__["']\]/
  }
];
var nosql_default = NOSQL_PATTERNS;

// node_modules/is-unsafe/src/contexts/log.js
var LOG_PATTERNS = [
  // ─── CRLF / newline injection ─────────────────────────────────────────────
  {
    id: "log-crlf-injection",
    description: "CRLF injection: literal \\r or \\n embeds fake log lines",
    pattern: /[\r\n]/
  },
  {
    id: "log-url-encoded-crlf",
    description: "URL-encoded CRLF: %0d, %0a, %0D, %0A \u2014 decoded by some log parsers",
    pattern: /%0[dDaA]/
  },
  {
    id: "log-unicode-newline",
    description: "Unicode newline variants: U+2028 (line separator), U+2029 (paragraph separator)",
    pattern: /[\u2028\u2029]/
  },
  // ─── Log4Shell / JNDI injection (CVE-2021-44228) ─────────────────────────
  {
    id: "log-log4shell-jndi",
    description: "Log4Shell: ${jndi:...} triggers remote code execution in Apache Log4j",
    pattern: /\$\{jndi\s*:/i
  },
  {
    id: "log-log4shell-obfuscated",
    description: "Obfuscated Log4Shell: ${::-j}... lookup-bypass prefix used to evade WAF detection",
    // ${::- is the Log4j lookup-bypass escape sequence; presence alone is suspicious
    pattern: /\$\{::-/
  },
  {
    id: "log-log4j-lookup",
    description: "Log4j lookup syntax: ${env:...}, ${sys:...}, ${ctx:...} \u2014 data exfiltration",
    pattern: /\$\{(?:env|sys|ctx|main|map|sd|web|docker|k8s|spring)\s*:/i
  },
  // ─── Server-Side Template Injection (SSTI) in log messages ───────────────
  {
    id: "log-ssti-double-brace",
    description: "SSTI double-brace: {{expression}} \u2014 Jinja2, Twig, Handlebars, etc.",
    pattern: /\{\{[\s\S]{0,80}\}\}/
  },
  {
    id: "log-ssti-hash-brace",
    description: "SSTI hash-brace: #{expression} \u2014 Thymeleaf, Velocity, Ruby ERB",
    pattern: /#\{[\s\S]{0,80}\}/
  },
  {
    id: "log-ssti-dollar-brace",
    description: "SSTI/EL injection: ${expression with operators or method calls} \u2014 JSP EL, Freemarker, SpEL",
    // Require that the ${...} content looks like an expression, not a plain variable name.
    // Flags if the content contains: . ( * + operators, or known SSTI keywords.
    // This avoids flagging ${PATH}, ${HOME} etc. (plain shell variables).
    pattern: /\$\{[^}]*(?:\.|\(|\*|\+|\bclass\b|\bruntime\b|\bprocess\b|\bexec\b)[^}]{0,80}\}/i
  },
  {
    id: "log-ssti-percent-tag",
    description: "SSTI ERB/ASP tag: <%= expression %> \u2014 Ruby ERB, ASP",
    pattern: /<%=[\s\S]{0,80}%>/
  },
  // ─── Null byte ────────────────────────────────────────────────────────────
  {
    id: "log-null-byte",
    description: "Null byte: \\x00 or %00 \u2014 can truncate log entries in C-backed loggers",
    pattern: /\x00|%00/
  },
  // ─── ANSI escape injection ────────────────────────────────────────────────
  {
    id: "log-ansi-escape",
    description: "ANSI escape sequence: ESC[ \u2014 can manipulate terminal output when logs are tailed",
    pattern: /\x1b\[/
  }
];
var log_default = LOG_PATTERNS;

// node_modules/is-unsafe/src/contexts/sql-strict.js
var SQL_STRICT_EXTRA = [
  {
    id: "sql-line-comment",
    description: "SQL line comment: -- followed by whitespace or end of string",
    pattern: /--(?:\s|$)/
  },
  {
    id: "sql-stacked-query",
    description: "Stacked queries: semicolon immediately followed by a SQL keyword",
    pattern: /;\s{0,10}(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC)\b/i
  },
  {
    id: "sql-hex-encoding",
    description: "Hex-encoded string injection: 0x41414141 style (MySQL)",
    pattern: /\b0x[0-9a-f]{4,}/i
  }
];
var SQL_STRICT_PATTERNS = [...sql_default, ...SQL_STRICT_EXTRA];
var sql_strict_default = SQL_STRICT_PATTERNS;

// node_modules/is-unsafe/src/util/decode-entities.js
var NAMED = Object.freeze({
  colon: ":",
  Tab: "	",
  NewLine: "\n"
});
var ENTITY_RE = /&(?:#[xX]0*([0-9a-fA-F]{1,6});?|#0*([0-9]{1,7});?|([a-zA-Z][a-zA-Z0-9]{1,15});)/g;
function decodeEntities(input) {
  if (input.indexOf("&") === -1) return input;
  return input.replace(ENTITY_RE, (match, hex, dec, name) => {
    if (name !== void 0) {
      return Object.prototype.hasOwnProperty.call(NAMED, name) ? NAMED[name] : match;
    }
    const cp = hex !== void 0 ? parseInt(hex, 16) : parseInt(dec, 10);
    if (!Number.isFinite(cp) || cp > 1114111) return match;
    return String.fromCodePoint(cp);
  });
}

// node_modules/is-unsafe/src/index.js
html_default.label = "HTML";
xml_default.label = "XML";
svg_default.label = "SVG";
html_default.decodeEntities = true;
xml_default.decodeEntities = true;
svg_default.decodeEntities = true;
sql_default.label = "SQL";
sql_strict_default.label = "SQL-STRICT";
shell_default.label = "SHELL";
redos_default.label = "REDOS";
nosql_default.label = "NOSQL";
log_default.label = "LOG";
var VALID_CONTEXTS = Object.freeze({
  HTML: html_default,
  XML: xml_default,
  SVG: svg_default,
  SQL: sql_default,
  "SQL-STRICT": sql_strict_default,
  SHELL: shell_default,
  REDOS: redos_default,
  NOSQL: nosql_default,
  LOG: log_default
});
function assertString(value) {
  if (typeof value !== "string") {
    throw new TypeError(
      `is-unsafe: first argument must be a string, got ${typeof value}`
    );
  }
}
function assertContext(context) {
  if (context instanceof RegExp) return;
  if (Array.isArray(context)) {
    if (context.length === 0) {
      throw new TypeError("is-unsafe: context must not be an empty array");
    }
    if (Array.isArray(context[0])) {
      for (const list of context) {
        if (!Array.isArray(list) || list.length === 0) {
          throw new TypeError(
            "is-unsafe: each context in the array must be a non-empty pattern array (PatternList)"
          );
        }
      }
    }
    return;
  }
  throw new TypeError(
    `is-unsafe: second argument must be a PatternList (e.g. HTML), an array of PatternLists (e.g. [HTML, XML]), or a RegExp. Got: ${typeof context}`
  );
}
function normalise(context) {
  if (context instanceof RegExp) return { lists: null, regex: context };
  if (Array.isArray(context[0])) return { lists: context, regex: null };
  return { lists: [context], regex: null };
}
function decodedCopy(value, list) {
  if (!list.decodeEntities) return null;
  const decoded = decodeEntities(value);
  return decoded === value ? null : decoded;
}
function matchList(value, list) {
  const label = list.label ?? "CUSTOM";
  const decoded = decodedCopy(value, list);
  for (const rule of list) {
    if (rule.pattern.test(value) || decoded !== null && rule.pattern.test(decoded)) {
      return { context: label, id: rule.id, description: rule.description, pattern: rule.pattern };
    }
  }
  return null;
}
function isUnsafe(value, context) {
  assertString(value);
  assertContext(context);
  const { lists, regex } = normalise(context);
  if (regex) return regex.test(value);
  for (const list of lists) {
    if (matchList(value, list) !== null) return true;
  }
  return false;
}

// node_modules/fast-xml-parser/src/xmlparser/OrderedObjParser.js
function extractRawAttributes(prefixedAttrs, options) {
  if (!prefixedAttrs) return {};
  const attrs = options.attributesGroupName ? prefixedAttrs[options.attributesGroupName] : prefixedAttrs;
  if (!attrs) return {};
  const rawAttrs = {};
  for (const key in attrs) {
    if (key.startsWith(options.attributeNamePrefix)) {
      const rawName = key.substring(options.attributeNamePrefix.length);
      rawAttrs[rawName] = attrs[key];
    } else {
      rawAttrs[key] = attrs[key];
    }
  }
  return rawAttrs;
}
function extractNamespace(rawTagName) {
  if (!rawTagName || typeof rawTagName !== "string") return void 0;
  const colonIndex = rawTagName.indexOf(":");
  if (colonIndex !== -1 && colonIndex > 0) {
    const ns2 = rawTagName.substring(0, colonIndex);
    if (ns2 !== "xmlns") {
      return ns2;
    }
  }
  return void 0;
}
var OrderedObjParser = class {
  constructor(options, externalEntities) {
    this.options = options;
    this.currentNode = null;
    this.tagsNodeStack = [];
    this.parseXml = parseXml;
    this.parseTextData = parseTextData;
    this.resolveNameSpace = resolveNameSpace;
    this.buildAttributesMap = buildAttributesMap;
    this.isItStopNode = isItStopNode;
    this.replaceEntitiesValue = replaceEntitiesValue;
    this.readStopNodeData = readStopNodeData;
    this.saveTextToParentTag = saveTextToParentTag;
    this.addChild = addChild;
    this.ignoreAttributesFn = getIgnoreAttributesFn(this.options.ignoreAttributes);
    this.entityExpansionCount = 0;
    this.currentExpandedLength = 0;
    this.doctypefound = false;
    let namedEntities = { ...XML };
    if (this.options.entityDecoder) {
      this.entityDecoder = this.options.entityDecoder;
    } else {
      if (typeof this.options.htmlEntities === "object") namedEntities = this.options.htmlEntities;
      else if (this.options.htmlEntities === true) namedEntities = { ...COMMON_HTML, ...CURRENCY };
      this.entityDecoder = new EntityDecoder({
        namedEntities: { ...namedEntities, ...externalEntities },
        numericAllowed: this.options.htmlEntities,
        limit: {
          maxTotalExpansions: this.options.processEntities.maxTotalExpansions,
          maxExpandedLength: this.options.processEntities.maxExpandedLength,
          applyLimitsTo: this.options.processEntities.appliesTo
        },
        // onExternalEntity: (name, value) => isUnsafe(value) ? 'block' : 'allow',
        onInputEntity: (name, value) => (
          //TODO: VALID_CONTEXTS.HTML should be set only if this.options.htmlEntities
          isUnsafe(value, [html_default, xml_default]) ? ENTITY_ACTION.BLOCK : ENTITY_ACTION.ALLOW
        )
        //postCheck: resolved => resolved
      });
    }
    this.matcher = new Matcher();
    this.readonlyMatcher = this.matcher.readOnly();
    this.isCurrentNodeStopNode = false;
    this.stopNodeExpressionsSet = new ExpressionSet();
    const stopNodesOpts = this.options.stopNodes;
    if (stopNodesOpts && stopNodesOpts.length > 0) {
      for (let i = 0; i < stopNodesOpts.length; i++) {
        const stopNodeExp = stopNodesOpts[i];
        if (typeof stopNodeExp === "string") {
          this.stopNodeExpressionsSet.add(new Expression(stopNodeExp));
        } else if (stopNodeExp instanceof Expression) {
          this.stopNodeExpressionsSet.add(stopNodeExp);
        }
      }
      this.stopNodeExpressionsSet.seal();
    }
  }
};
function parseTextData(val, tagName, jPath, dontTrim, hasAttributes, isLeafNode, escapeEntities) {
  const options = this.options;
  if (val !== void 0) {
    if (options.trimValues && !dontTrim) {
      val = val.trim();
    }
    if (val.length > 0) {
      if (!escapeEntities) val = this.replaceEntitiesValue(val, tagName, jPath);
      const jPathOrMatcher = options.jPath ? jPath.toString() : jPath;
      const newval = options.tagValueProcessor(tagName, val, jPathOrMatcher, hasAttributes, isLeafNode);
      if (newval === null || newval === void 0) {
        return val;
      } else if (typeof newval !== typeof val || newval !== val) {
        return newval;
      } else if (options.trimValues) {
        return parseValue(val, options.parseTagValue, options.numberParseOptions);
      } else {
        const trimmedVal = val.trim();
        if (trimmedVal === val) {
          return parseValue(val, options.parseTagValue, options.numberParseOptions);
        } else {
          return val;
        }
      }
    }
  }
}
function resolveNameSpace(tagname) {
  if (this.options.removeNSPrefix) {
    const tags = tagname.split(":");
    const prefix = tagname.charAt(0) === "/" ? "/" : "";
    if (tags[0] === "xmlns") {
      return "";
    }
    if (tags.length === 2) {
      tagname = prefix + tags[1];
    }
  }
  return tagname;
}
var attrsRegx = /([^\s=]+)\s*(=\s*(?:"([^"]*)"|'([^']*)'))?/gm;
function attrValue(match) {
  return match[3] !== void 0 ? match[3] : match[4];
}
function buildAttributesMap(attrStr, jPath, tagName, force = false) {
  const options = this.options;
  if (force === true || options.ignoreAttributes !== true && typeof attrStr === "string") {
    const matches = getAllMatches(attrStr, attrsRegx);
    const len = matches.length;
    const attrs = {};
    const processedVals = new Array(len);
    let hasRawAttrs = false;
    const rawAttrsForMatcher = {};
    for (let i = 0; i < len; i++) {
      const attrName = this.resolveNameSpace(matches[i][1]);
      const oldVal = attrValue(matches[i]);
      if (attrName.length && oldVal !== void 0) {
        let val = oldVal;
        if (options.trimValues) val = val.trim();
        val = this.replaceEntitiesValue(val, tagName, this.readonlyMatcher);
        processedVals[i] = val;
        rawAttrsForMatcher[attrName] = val;
        hasRawAttrs = true;
      }
    }
    if (hasRawAttrs && typeof jPath === "object" && jPath.updateCurrent) {
      jPath.updateCurrent(rawAttrsForMatcher);
    }
    const jPathStr = options.jPath ? jPath.toString() : this.readonlyMatcher;
    let hasAttrs = false;
    for (let i = 0; i < len; i++) {
      const attrName = this.resolveNameSpace(matches[i][1]);
      if (this.ignoreAttributesFn(attrName, jPathStr)) continue;
      let aName = options.attributeNamePrefix + attrName;
      if (attrName.length) {
        if (options.transformAttributeName) {
          aName = options.transformAttributeName(aName);
        }
        aName = sanitizeName(aName, options);
        if (attrValue(matches[i]) !== void 0) {
          const oldVal = processedVals[i];
          const newVal = options.attributeValueProcessor(attrName, oldVal, jPathStr);
          if (newVal === null || newVal === void 0) {
            attrs[aName] = oldVal;
          } else if (typeof newVal !== typeof oldVal || newVal !== oldVal) {
            attrs[aName] = newVal;
          } else {
            attrs[aName] = parseValue(oldVal, options.parseAttributeValue, options.numberParseOptions);
          }
          hasAttrs = true;
        } else if (options.allowBooleanAttributes) {
          attrs[aName] = true;
          hasAttrs = true;
        }
      }
    }
    if (!hasAttrs) return;
    if (options.attributesGroupName && !options.preserveOrder) {
      const attrCollection = {};
      attrCollection[options.attributesGroupName] = attrs;
      return attrCollection;
    }
    return attrs;
  }
}
var parseXml = function(xmlData) {
  const options = this.options;
  const crlfPositions = options.captureMetaData ? [] : void 0;
  xmlData = xmlData.replace(/\r\n?/g, options.captureMetaData ? (newline, index) => {
    if (newline.length === 2) {
      crlfPositions.push(index - crlfPositions.length);
    }
    return "\n";
  } : "\n");
  const xmlObj = new XmlNode("!xml");
  let currentNode = xmlObj;
  let textData = "";
  this.matcher.reset();
  this.entityDecoder.reset();
  this.entityExpansionCount = 0;
  this.currentExpandedLength = 0;
  this.doctypefound = false;
  const docTypeReader = new DocTypeReader(options.processEntities);
  const xmlLen = xmlData.length;
  for (let i = 0; i < xmlLen; i++) {
    const ch = xmlData[i];
    if (ch === "<") {
      const c1 = xmlData.charCodeAt(i + 1);
      if (c1 === 47) {
        const closeIndex = findClosingIndex(xmlData, ">", i, "Closing Tag is not closed.");
        let tagName = xmlData.substring(i + 2, closeIndex).trim();
        if (options.removeNSPrefix) {
          const colonIndex = tagName.indexOf(":");
          if (colonIndex !== -1) {
            tagName = tagName.substr(colonIndex + 1);
          }
        }
        tagName = transformTagName(options.transformTagName, tagName, "", options).tagName;
        if (currentNode) {
          textData = this.saveTextToParentTag(textData, currentNode, this.readonlyMatcher);
        }
        const lastTagName = this.matcher.getCurrentTag();
        if (tagName && options.unpairedTagsSet.has(tagName)) {
          throw new Error(`Unpaired tag can not be used as closing tag: </${tagName}>`);
        }
        if (lastTagName && options.unpairedTagsSet.has(lastTagName)) {
          this.matcher.pop();
          this.tagsNodeStack.pop();
        }
        this.matcher.pop();
        this.isCurrentNodeStopNode = false;
        currentNode = this.tagsNodeStack.pop() || xmlObj;
        if (options.captureMetaData && currentNode) {
          currentNode.addEndIndex(getOriginalIndex(closeIndex + 1, crlfPositions));
        }
        textData = "";
        i = closeIndex;
      } else if (c1 === 63) {
        let tagData = readTagExp(xmlData, i, false, "?>");
        if (!tagData) throw new Error("Pi Tag is not closed.");
        textData = this.saveTextToParentTag(textData, currentNode, this.readonlyMatcher);
        const attsMap = this.buildAttributesMap(tagData.tagExp, this.matcher, tagData.tagName, true);
        if (attsMap) {
          const ver = attsMap[this.options.attributeNamePrefix + "version"];
          this.entityDecoder.setXmlVersion(Number(ver) || 1);
          docTypeReader.setXmlVersion(Number(ver) || 1);
        }
        if (options.ignoreDeclaration && tagData.tagName === "?xml" || options.ignorePiTags) {
        } else {
          const childNode = new XmlNode(tagData.tagName);
          childNode.add(options.textNodeName, "");
          if (tagData.tagName !== tagData.tagExp && tagData.attrExpPresent && options.ignoreAttributes !== true) {
            childNode[":@"] = attsMap;
          }
          const startIndex = options.captureMetaData ? getOriginalIndex(i, crlfPositions) : i;
          this.addChild(currentNode, childNode, this.readonlyMatcher, startIndex);
          if (options.captureMetaData) {
            currentNode.addEndIndex(getOriginalIndex(tagData.closeIndex + 2, crlfPositions));
          }
        }
        i = tagData.closeIndex + 1;
      } else if (c1 === 33 && xmlData.charCodeAt(i + 2) === 45 && xmlData.charCodeAt(i + 3) === 45) {
        const endIndex = findClosingIndex(xmlData, "-->", i + 4, "Comment is not closed.");
        if (options.commentPropName) {
          const comment = xmlData.substring(i + 4, endIndex - 2);
          textData = this.saveTextToParentTag(textData, currentNode, this.readonlyMatcher);
          currentNode.add(options.commentPropName, [{ [options.textNodeName]: comment }]);
        }
        i = endIndex;
      } else if (c1 === 33 && xmlData.charCodeAt(i + 2) === 68) {
        if (this.doctypefound) throw new Error("Multiple DOCTYPE declarations found.");
        this.doctypefound = true;
        const result = docTypeReader.readDocType(xmlData, i);
        this.entityDecoder.addInputEntities(result.entities);
        i = result.i;
      } else if (c1 === 33 && xmlData.charCodeAt(i + 2) === 91) {
        const closeIndex = findClosingIndex(xmlData, "]]>", i, "CDATA is not closed.") - 2;
        const tagExp = xmlData.substring(i + 9, closeIndex);
        textData = this.saveTextToParentTag(textData, currentNode, this.readonlyMatcher);
        let val = this.parseTextData(tagExp, currentNode.tagname, this.readonlyMatcher, true, false, true, true);
        if (val == void 0) val = "";
        if (options.cdataPropName) {
          currentNode.add(options.cdataPropName, [{ [options.textNodeName]: tagExp }]);
        } else {
          currentNode.add(options.textNodeName, val);
        }
        i = closeIndex + 2;
      } else {
        let result = readTagExp(xmlData, i, options.removeNSPrefix);
        if (!result) {
          const context = xmlData.substring(Math.max(0, i - 50), Math.min(xmlLen, i + 50));
          throw new Error(`readTagExp returned undefined at position ${i}. Context: "${context}"`);
        }
        let tagName = result.tagName;
        const rawTagName = result.rawTagName;
        let tagExp = result.tagExp;
        let attrExpPresent = result.attrExpPresent;
        let closeIndex = result.closeIndex;
        ({ tagName, tagExp } = transformTagName(options.transformTagName, tagName, tagExp, options));
        if (options.strictReservedNames && (tagName === options.commentPropName || tagName === options.cdataPropName || tagName === options.textNodeName || tagName === options.attributesGroupName)) {
          throw new Error(`Invalid tag name: ${tagName}`);
        }
        if (currentNode && textData) {
          if (currentNode.tagname !== "!xml") {
            textData = this.saveTextToParentTag(textData, currentNode, this.readonlyMatcher, false);
          }
        }
        const lastTag = currentNode;
        if (lastTag && options.unpairedTagsSet.has(lastTag.tagname)) {
          currentNode = this.tagsNodeStack.pop();
          this.matcher.pop();
        }
        let isSelfClosing = false;
        if (tagExp.length > 0 && tagExp.lastIndexOf("/") === tagExp.length - 1) {
          isSelfClosing = true;
          if (tagName[tagName.length - 1] === "/") {
            tagName = tagName.substr(0, tagName.length - 1);
            tagExp = tagName;
          } else {
            tagExp = tagExp.substr(0, tagExp.length - 1);
          }
          attrExpPresent = tagName !== tagExp;
        }
        let prefixedAttrs = null;
        let rawAttrs = {};
        let namespace = void 0;
        namespace = extractNamespace(rawTagName);
        if (tagName !== xmlObj.tagname) {
          this.matcher.push(tagName, {}, namespace);
        }
        if (tagName !== tagExp && attrExpPresent) {
          prefixedAttrs = this.buildAttributesMap(tagExp, this.matcher, tagName);
          if (prefixedAttrs) {
            rawAttrs = extractRawAttributes(prefixedAttrs, options);
          }
        }
        if (tagName !== xmlObj.tagname) {
          this.isCurrentNodeStopNode = this.isItStopNode();
        }
        const startIndex = options.captureMetaData ? getOriginalIndex(i, crlfPositions) : i;
        if (this.isCurrentNodeStopNode) {
          let tagContent = "";
          if (isSelfClosing) {
            i = result.closeIndex;
          } else if (options.unpairedTagsSet.has(tagName)) {
            i = result.closeIndex;
          } else {
            const result2 = this.readStopNodeData(xmlData, rawTagName, closeIndex + 1);
            if (!result2) throw new Error(`Unexpected end of ${rawTagName}`);
            i = result2.i;
            tagContent = result2.tagContent;
          }
          const childNode = new XmlNode(tagName);
          if (prefixedAttrs) {
            childNode[":@"] = prefixedAttrs;
          }
          childNode.add(options.textNodeName, tagContent);
          this.matcher.pop();
          this.isCurrentNodeStopNode = false;
          this.addChild(currentNode, childNode, this.readonlyMatcher, startIndex);
          if (options.captureMetaData) {
            currentNode.addEndIndex(getOriginalIndex(i + 1, crlfPositions));
          }
        } else {
          if (isSelfClosing) {
            ({ tagName, tagExp } = transformTagName(options.transformTagName, tagName, tagExp, options));
            const childNode = new XmlNode(tagName);
            if (prefixedAttrs) {
              childNode[":@"] = prefixedAttrs;
            }
            this.addChild(currentNode, childNode, this.readonlyMatcher, startIndex);
            if (options.captureMetaData) {
              currentNode.addEndIndex(getOriginalIndex(closeIndex + 1, crlfPositions));
            }
            this.matcher.pop();
            this.isCurrentNodeStopNode = false;
          } else if (options.unpairedTagsSet.has(tagName)) {
            const childNode = new XmlNode(tagName);
            if (prefixedAttrs) {
              childNode[":@"] = prefixedAttrs;
            }
            this.addChild(currentNode, childNode, this.readonlyMatcher, startIndex);
            if (options.captureMetaData) {
              currentNode.addEndIndex(getOriginalIndex(result.closeIndex + 1, crlfPositions));
            }
            this.matcher.pop();
            this.isCurrentNodeStopNode = false;
            i = result.closeIndex;
            continue;
          } else {
            const childNode = new XmlNode(tagName);
            if (this.tagsNodeStack.length > options.maxNestedTags) {
              throw new Error("Maximum nested tags exceeded");
            }
            this.tagsNodeStack.push(currentNode);
            if (prefixedAttrs) {
              childNode[":@"] = prefixedAttrs;
            }
            this.addChild(currentNode, childNode, this.readonlyMatcher, startIndex);
            currentNode = childNode;
          }
          textData = "";
          i = closeIndex;
        }
      }
    } else {
      textData += xmlData[i];
    }
  }
  return xmlObj.child;
};
function getOriginalIndex(index, crlfPositions) {
  let low = 0;
  let high = crlfPositions.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (crlfPositions[middle] < index) low = middle + 1;
    else high = middle;
  }
  return index + low;
}
function addChild(currentNode, childNode, matcher, startIndex) {
  if (!this.options.captureMetaData) startIndex = void 0;
  const jPathOrMatcher = this.options.jPath ? matcher.toString() : matcher;
  const result = this.options.updateTag(childNode.tagname, jPathOrMatcher, childNode[":@"]);
  if (result === false) {
  } else if (typeof result === "string") {
    childNode.tagname = result;
    currentNode.addChild(childNode, startIndex);
  } else {
    currentNode.addChild(childNode, startIndex);
  }
}
function replaceEntitiesValue(val, tagName, jPath) {
  const entityConfig = this.options.processEntities;
  if (!entityConfig || !entityConfig.enabled) {
    return val;
  }
  if (entityConfig.allowedTags) {
    const jPathOrMatcher = this.options.jPath ? jPath.toString() : jPath;
    const allowed = Array.isArray(entityConfig.allowedTags) ? entityConfig.allowedTags.includes(tagName) : entityConfig.allowedTags(tagName, jPathOrMatcher);
    if (!allowed) {
      return val;
    }
  }
  if (entityConfig.tagFilter) {
    const jPathOrMatcher = this.options.jPath ? jPath.toString() : jPath;
    if (!entityConfig.tagFilter(tagName, jPathOrMatcher)) {
      return val;
    }
  }
  return this.entityDecoder.decode(val);
}
function saveTextToParentTag(textData, parentNode, matcher, isLeafNode) {
  if (textData) {
    if (isLeafNode === void 0) isLeafNode = parentNode.child.length === 0;
    textData = this.parseTextData(
      textData,
      parentNode.tagname,
      matcher,
      false,
      parentNode[":@"] ? Object.keys(parentNode[":@"]).length !== 0 : false,
      isLeafNode
    );
    if (textData !== void 0 && textData !== "")
      parentNode.add(this.options.textNodeName, textData);
    textData = "";
  }
  return textData;
}
function isItStopNode() {
  if (this.stopNodeExpressionsSet.size === 0) return false;
  return this.matcher.matchesAny(this.stopNodeExpressionsSet);
}
function tagExpWithClosingIndex(xmlData, i, closingChar = ">") {
  const len = xmlData.length;
  const closeCode0 = closingChar.charCodeAt(0);
  const closeCode1 = closingChar.length > 1 ? closingChar.charCodeAt(1) : -1;
  let result = "";
  let segmentStart = i;
  for (let index = i; index < len; index++) {
    const code = xmlData.charCodeAt(index);
    if (code === 34 || code === 39) {
      index = xmlData.indexOf(xmlData[index], index + 1);
      if (index === -1) return;
    } else if (code === closeCode0) {
      if (closeCode1 !== -1) {
        if (xmlData.charCodeAt(index + 1) === closeCode1) {
          result += xmlData.substring(segmentStart, index);
          return { data: result, index };
        }
      } else {
        result += xmlData.substring(segmentStart, index);
        return { data: result, index };
      }
    } else if (code === 9) {
      result += xmlData.substring(segmentStart, index) + " ";
      segmentStart = index + 1;
    }
  }
}
function findClosingIndex(xmlData, str, i, errMsg) {
  const closingIndex = xmlData.indexOf(str, i);
  if (closingIndex === -1) {
    throw new Error(errMsg);
  } else {
    return closingIndex + str.length - 1;
  }
}
function findClosingChar(xmlData, char, i, errMsg) {
  const closingIndex = xmlData.indexOf(char, i);
  if (closingIndex === -1) throw new Error(errMsg);
  return closingIndex;
}
function readTagExp(xmlData, i, removeNSPrefix, closingChar = ">") {
  const result = tagExpWithClosingIndex(xmlData, i + 1, closingChar);
  if (!result) return;
  let tagExp = result.data;
  const closeIndex = result.index;
  const separatorIndex = tagExp.search(/\s/);
  let tagName = tagExp;
  let attrExpPresent = true;
  if (separatorIndex !== -1) {
    tagName = tagExp.substring(0, separatorIndex);
    tagExp = tagExp.substring(separatorIndex + 1).trimStart();
  }
  const rawTagName = tagName;
  if (removeNSPrefix) {
    const colonIndex = tagName.indexOf(":");
    if (colonIndex !== -1) {
      tagName = tagName.substr(colonIndex + 1);
      attrExpPresent = tagName !== result.data.substr(colonIndex + 1);
    }
  }
  return {
    tagName,
    tagExp,
    closeIndex,
    attrExpPresent,
    rawTagName
  };
}
function readStopNodeData(xmlData, tagName, i) {
  const startIndex = i;
  let openTagCount = 1;
  let lenient = false;
  let nextGt = -1;
  const xmllen = xmlData.length;
  for (; i < xmllen; i++) {
    if (xmlData[i] === "<") {
      const c1 = xmlData.charCodeAt(i + 1);
      if (c1 === 47) {
        const closeIndex = findClosingChar(xmlData, ">", i, `${tagName} is not closed`);
        let closeTagName = xmlData.substring(i + 2, closeIndex).trim();
        if (closeTagName === tagName) {
          openTagCount--;
          if (openTagCount === 0) {
            return {
              tagContent: xmlData.substring(startIndex, i),
              i: closeIndex
            };
          }
        }
        i = closeIndex;
      } else if (c1 === 63) {
        const closeIndex = findClosingIndex(xmlData, "?>", i + 1, "StopNode is not closed.");
        i = closeIndex;
      } else if (c1 === 33 && xmlData.charCodeAt(i + 2) === 45 && xmlData.charCodeAt(i + 3) === 45) {
        const closeIndex = findClosingIndex(xmlData, "-->", i + 3, "StopNode is not closed.");
        i = closeIndex;
      } else if (c1 === 33 && xmlData.charCodeAt(i + 2) === 91) {
        const closeIndex = findClosingIndex(xmlData, "]]>", i, "StopNode is not closed.") - 2;
        i = closeIndex;
      } else {
        const tagData = lenient ? void 0 : readTagExp(xmlData, i, false);
        if (tagData) {
          const openTagName = tagData.tagName;
          if (openTagName === tagName && tagData.tagExp[tagData.tagExp.length - 1] !== "/") {
            openTagCount++;
          }
          i = tagData.closeIndex;
        } else {
          lenient = true;
          if (nextGt < i) {
            nextGt = xmlData.indexOf(">", i);
            if (nextGt === -1) return;
          }
          const nextLt = xmlData.indexOf("<", i + 1);
          if (nextLt === -1 || nextLt > nextGt) {
            const exp = xmlData.substring(i + 1, nextGt);
            const sep2 = exp.search(/\s/);
            const name = sep2 === -1 ? exp : exp.substring(0, sep2);
            if (name === tagName && exp[exp.length - 1] !== "/") openTagCount++;
            i = nextGt;
          }
        }
      }
    }
  }
}
function parseValue(val, shouldParse, options) {
  if (shouldParse && typeof val === "string") {
    const newval = val.trim();
    if (newval === "true") return true;
    else if (newval === "false") return false;
    else return toNumber(val, options);
  } else {
    if (isExist(val)) {
      return val;
    } else {
      return "";
    }
  }
}
function transformTagName(fn, tagName, tagExp, options) {
  if (fn) {
    const newTagName = fn(tagName);
    if (tagExp === tagName) {
      tagExp = newTagName;
    }
    tagName = newTagName;
  }
  tagName = sanitizeName(tagName, options);
  return { tagName, tagExp };
}
function sanitizeName(name, options) {
  if (criticalProperties.includes(name)) {
    throw new Error(`[SECURITY] Invalid name: "${name}" is a reserved JavaScript keyword that could cause prototype pollution`);
  } else if (DANGEROUS_PROPERTY_NAMES.includes(name)) {
    return options.onDangerousProperty(name);
  }
  return name;
}

// node_modules/fast-xml-parser/src/xmlparser/node2json.js
var METADATA_SYMBOL2 = XmlNode.getMetaDataSymbol();
function stripAttributePrefix(attrs, prefix) {
  if (!attrs || typeof attrs !== "object") return {};
  if (!prefix) return attrs;
  const rawAttrs = {};
  for (const key in attrs) {
    if (key.startsWith(prefix)) {
      const rawName = key.substring(prefix.length);
      rawAttrs[rawName] = attrs[key];
    } else {
      rawAttrs[key] = attrs[key];
    }
  }
  return rawAttrs;
}
function prettify(node, options, matcher, readonlyMatcher) {
  return compress(node, options, matcher, readonlyMatcher);
}
function compress(arr, options, matcher, readonlyMatcher) {
  let text;
  const compressedObj = {};
  for (let i = 0; i < arr.length; i++) {
    const tagObj = arr[i];
    const property = propName(tagObj);
    if (property !== void 0 && property !== options.textNodeName) {
      const rawAttrs = stripAttributePrefix(
        tagObj[":@"] || {},
        options.attributeNamePrefix
      );
      matcher.push(property, rawAttrs);
    }
    if (property === options.textNodeName) {
      if (text === void 0) text = tagObj[property];
      else text += "" + tagObj[property];
    } else if (property === void 0) {
      continue;
    } else if (tagObj[property]) {
      let val = compress(tagObj[property], options, matcher, readonlyMatcher);
      const isLeaf = isLeafTag(val, options);
      if (Object.keys(val).length === 0 && options.alwaysCreateTextNode) {
        val[options.textNodeName] = "";
      }
      if (tagObj[":@"]) {
        assignAttributes(val, tagObj[":@"], readonlyMatcher, options);
      } else if (Object.keys(val).length === 1 && val[options.textNodeName] !== void 0 && !options.alwaysCreateTextNode) {
        val = val[options.textNodeName];
      } else if (Object.keys(val).length === 0) {
        if (options.alwaysCreateTextNode) val[options.textNodeName] = "";
        else val = "";
      }
      if (tagObj[METADATA_SYMBOL2] !== void 0 && typeof val === "object" && val !== null) {
        val[METADATA_SYMBOL2] = tagObj[METADATA_SYMBOL2];
      }
      if (compressedObj[property] !== void 0 && Object.prototype.hasOwnProperty.call(compressedObj, property)) {
        if (!Array.isArray(compressedObj[property])) {
          compressedObj[property] = [compressedObj[property]];
        }
        compressedObj[property].push(val);
      } else {
        const jPathOrMatcher = options.jPath ? readonlyMatcher.toString() : readonlyMatcher;
        if (options.isArray(property, jPathOrMatcher, isLeaf)) {
          compressedObj[property] = [val];
        } else {
          compressedObj[property] = val;
        }
      }
      if (property !== void 0 && property !== options.textNodeName) {
        matcher.pop();
      }
    }
  }
  if (typeof text === "string") {
    if (text.length > 0) compressedObj[options.textNodeName] = text;
  } else if (text !== void 0) compressedObj[options.textNodeName] = text;
  return compressedObj;
}
function propName(obj) {
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key !== ":@") return key;
  }
}
function assignAttributes(obj, attrMap, readonlyMatcher, options) {
  if (attrMap) {
    const keys = Object.keys(attrMap);
    const len = keys.length;
    for (let i = 0; i < len; i++) {
      const atrrName = keys[i];
      const rawAttrName = atrrName.startsWith(options.attributeNamePrefix) ? atrrName.substring(options.attributeNamePrefix.length) : atrrName;
      const jPathOrMatcher = options.jPath ? readonlyMatcher.toString() + "." + rawAttrName : readonlyMatcher;
      if (options.isArray(atrrName, jPathOrMatcher, true, true)) {
        obj[atrrName] = [attrMap[atrrName]];
      } else {
        obj[atrrName] = attrMap[atrrName];
      }
    }
  }
}
function isLeafTag(obj, options) {
  const { textNodeName } = options;
  const propCount = Object.keys(obj).length;
  if (propCount === 0) {
    return true;
  }
  if (propCount === 1 && (obj[textNodeName] || typeof obj[textNodeName] === "boolean" || obj[textNodeName] === 0)) {
    return true;
  }
  return false;
}

// node_modules/fast-xml-parser/src/xmlparser/XMLParser.js
var XMLParser = class {
  constructor(options) {
    this.externalEntities = {};
    this.options = buildOptions(options);
  }
  /**
   * Parse XML dats to JS object 
   * @param {string|Uint8Array} xmlData 
   * @param {boolean|Object} validationOption 
   */
  parse(xmlData, validationOption) {
    if (typeof xmlData !== "string" && xmlData.toString) {
      if (xmlData instanceof Uint8Array && !(typeof Buffer !== "undefined" && Buffer.isBuffer(xmlData))) {
        xmlData = new TextDecoder("utf-8", { ignoreBOM: true }).decode(xmlData);
      } else {
        xmlData = xmlData.toString();
      }
    } else if (typeof xmlData !== "string") {
      throw new Error("XML data is accepted in String or Bytes[] form.");
    }
    if (validationOption) {
      if (validationOption === true) validationOption = {};
      const result = validate(xmlData, validationOption);
      if (result !== true) {
        throw Error(`${result.err.msg}:${result.err.line}:${result.err.col}`);
      }
    }
    const orderedObjParser = new OrderedObjParser(this.options, this.externalEntities);
    const orderedResult = orderedObjParser.parseXml(xmlData);
    if (this.options.preserveOrder || orderedResult === void 0) return orderedResult;
    else return prettify(orderedResult, this.options, orderedObjParser.matcher, orderedObjParser.readonlyMatcher);
  }
  /**
   * Add Entity which is not by default supported by this library
   * @param {string} key 
   * @param {string} value 
   */
  addEntity(key, value) {
    if (value.indexOf("&") !== -1) {
      throw new Error("Entity value can't have '&'");
    } else if (key.indexOf("&") !== -1 || key.indexOf(";") !== -1) {
      throw new Error("An entity must be set without '&' and ';'. Eg. use '#xD' for '&#xD;'");
    } else if (value === "&") {
      throw new Error("An entity with value '&' is not permitted");
    } else {
      this.externalEntities[key] = value;
    }
  }
  /**
   * Returns a Symbol that can be used to access the metadata
   * property on a node.
   * 
   * If Symbol is not available in the environment, an ordinary property is used
   * and the name of the property is here returned.
   * 
   * The XMLMetaData property is only present when `captureMetaData`
   * is true in the options.
   */
  static getMetaDataSymbol() {
    return XmlNode.getMetaDataSymbol();
  }
};

// node_modules/@pagus-kit/core/dist/index.js
var import_jszip = __toESM(require_jszip_min(), 1);
var la = 43200;
var ka = Math.PI / (6e4 * 180);
var qa = 27273042316900;
var Ma = 16777215;
var lm = {
  "+-": "sum",
  "*/": "product",
  "+/": "addDivide",
  abs: "abs",
  min: "min",
  max: "max",
  "?:": "if",
  sqrt: "sqrt",
  mod: "mod",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  at2: "atan2",
  sat2: "sinAtan2",
  cat2: "cosAtan2",
  pin: "pin",
  val: "val"
};
function Na(a, n, m) {
  const t = a.trim().split(/\s+/), o = t[0] ?? "val", l = lm[o] ?? "val";
  return {
    name: m,
    type: l,
    p1: t[1] ?? "0",
    p2: t[2] ?? "0",
    p3: t[3] ?? "0",
    index: n
  };
}
var sm = class {
  constructor() {
    this.shapeW = la, this.shapeH = la, this.scaleOut = 1, this.adjustFormulas = [], this.adjustValues = [], this.adjustIndex = /* @__PURE__ */ new Map(), this.guideFormulas = [], this.guideValues = [], this.guideIndex = /* @__PURE__ */ new Map(), this.addBuiltinGuides();
  }
  /** Normalise so the longer axis equals SHAPE_SIZE; remember the scale-back factor. */
  setWidthHeight(n, m) {
    if (n <= 0 || m <= 0) return;
    this.clearGuides();
    const t = Math.max(n, m);
    this.scaleOut = t / la, n > m ? (this.shapeW = la, this.shapeH = Math.max(1, m * la / n)) : n < m ? (this.shapeW = Math.max(1, n * la / m), this.shapeH = la) : (this.shapeW = la, this.shapeH = la);
  }
  /** Multiply a value computed in normalised space back into the real coordinate space. */
  get scaleFactor() {
    return this.scaleOut;
  }
  get width() {
    return this.shapeW;
  }
  get height() {
    return this.shapeH;
  }
  addAdjustment(n, m) {
    const t = this.adjustIndex.get(n);
    if (t != null) {
      this.adjustFormulas[t] = Na(m, t + 1, n), this.adjustValues[t] = Ma;
      return;
    }
    const o = this.adjustFormulas.length;
    this.adjustFormulas.push(Na(m, o + 1, n)), this.adjustValues.push(Ma), this.adjustIndex.set(n, o);
  }
  addGuide(n, m) {
    const t = this.guideFormulas.length;
    this.guideFormulas.push(Na(m, -(t + 1), n)), this.guideValues.push(qa), this.guideIndex.set(n, t);
  }
  /** Override an adjust value (raw OOXML scale, e.g. 25000 for 25%). */
  setAdjustValue(n, m) {
    const t = this.adjustIndex.get(n);
    t != null && (this.adjustValues[t] = m);
  }
  /** Resolve `w`, `h`, a literal integer, or a named guide/adjust reference. */
  getValue(n) {
    if (n === "w") return this.shapeW;
    if (n === "h") return this.shapeH;
    const m = this.guideIndex.get(n);
    if (m != null) {
      const l = this.guideValues[m];
      return l < qa ? l : this.calcFormula(this.guideFormulas[m]);
    }
    const t = this.adjustIndex.get(n);
    if (t != null) {
      const l = this.adjustValues[t];
      return l !== Ma ? l : this.calcFormula(this.adjustFormulas[t]);
    }
    const o = Number(n);
    return Number.isFinite(o) ? o : 0;
  }
  /** Evaluate every guide formula in order, populating the value cache. */
  reCalculateGuides() {
    this.clearGuides();
    for (let n = 0; n < this.guideFormulas.length; n++)
      this.guideValues[n] = this.calcFormula(this.guideFormulas[n]);
  }
  clearGuides() {
    for (let n = 0; n < this.guideValues.length; n++)
      this.guideValues[n] = qa;
  }
  calcFormula(n) {
    const { index: m } = n;
    if (m < 0) {
      const e = -m - 1, d2 = this.guideValues[e];
      if (d2 < qa) return d2;
    } else if (m > 0) {
      const e = m - 1, d2 = this.adjustValues[e];
      if (d2 !== Ma) return d2;
    }
    const t = this.getValue(n.p1), o = this.getValue(n.p2), l = this.getValue(n.p3);
    let s2 = 0;
    switch (n.type) {
      case "sum":
        s2 = t + o - l;
        break;
      case "product":
        s2 = l === 0 ? 0 : t * o / l;
        break;
      case "addDivide":
        s2 = l === 0 ? 0 : (t + o) / l;
        break;
      case "abs":
        s2 = Math.abs(t);
        break;
      case "min":
        s2 = Math.min(t, o);
        break;
      case "max":
        s2 = Math.max(t, o);
        break;
      case "if":
        s2 = t > 0 ? o : l;
        break;
      case "sqrt":
        s2 = t >= 0 ? Math.sqrt(t) : 0;
        break;
      case "mod":
        s2 = Math.sqrt(t * t + o * o + l * l);
        break;
      case "sin":
        s2 = t * Math.sin(o * ka);
        break;
      case "cos":
        s2 = t * Math.cos(o * ka);
        break;
      case "tan":
        s2 = t * Math.tan(o * ka);
        break;
      case "atan2":
        s2 = Math.atan2(o, t) / ka;
        break;
      case "sinAtan2":
        s2 = t * Math.sin(Math.atan2(l, o));
        break;
      case "cosAtan2":
        s2 = t * Math.cos(Math.atan2(l, o));
        break;
      case "pin":
        s2 = o < t ? t : o > l ? l : o;
        break;
      case "val":
        s2 = t;
        break;
    }
    return m < 0 ? this.guideValues[-m - 1] = s2 : m > 0 && (this.adjustValues[m - 1] = s2), s2;
  }
  /**
   * OOXML spec §20.1.9.11 — the fixed set of variables every shape inherits.
   * Angles here are in 60000ths of a degree.
   */
  addBuiltinGuides() {
    this.addGuide("3cd4", "val 16200000"), this.addGuide("3cd8", "val 8100000"), this.addGuide("5cd8", "val 13500000"), this.addGuide("7cd8", "val 18900000"), this.addGuide("cd2", "val 10800000"), this.addGuide("cd4", "val 5400000"), this.addGuide("cd8", "val 2700000"), this.addGuide("b", "val h"), this.addGuide("t", "val 0"), this.addGuide("l", "val 0"), this.addGuide("r", "val w"), this.addGuide("hc", "*/ w 1 2"), this.addGuide("vc", "*/ h 1 2"), this.addGuide("hd2", "*/ h 1 2"), this.addGuide("hd3", "*/ h 1 3"), this.addGuide("hd4", "*/ h 1 4"), this.addGuide("hd5", "*/ h 1 5"), this.addGuide("hd6", "*/ h 1 6"), this.addGuide("hd8", "*/ h 1 8"), this.addGuide("wd2", "*/ w 1 2"), this.addGuide("wd3", "*/ w 1 3"), this.addGuide("wd4", "*/ w 1 4"), this.addGuide("wd5", "*/ w 1 5"), this.addGuide("wd6", "*/ w 1 6"), this.addGuide("wd8", "*/ w 1 8"), this.addGuide("wd10", "*/ w 1 10"), this.addGuide("wd32", "*/ w 1 32"), this.addGuide("ls", "max w h"), this.addGuide("ss", "min w h"), this.addGuide("ssd2", "*/ ss 1 2"), this.addGuide("ssd4", "*/ ss 1 4"), this.addGuide("ssd6", "*/ ss 1 6"), this.addGuide("ssd8", "*/ ss 1 8"), this.addGuide("ssd16", "*/ ss 1 16"), this.addGuide("ssd32", "*/ ss 1 32");
  }
};
var em = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 18750" /><gd name="adj2" fmla="val -8333" /><gd name="adj3" fmla="val 112500" /><gd name="adj4" fmla="val -38333" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y1" fmla="*/ h adj1 100000" /><gd name="x1" fmla="*/ w adj2 100000" /><gd name="y2" fmla="*/ h adj3 100000" /><gd name="x2" fmla="*/ w adj4 100000" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj2" minX="-2147483647" maxX="2147483647" gdRefY="adj1" minY="-2147483647" maxY="2147483647"><pos x="x1" y="y1" /></ahXY><ahXY gdRefX="adj4" minX="-2147483647" maxX="2147483647" gdRefY="adj3" minY="-2147483647" maxY="2147483647"><pos x="x2" y="y2" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="t" /></moveTo><close /><lnTo><pt x="x1" y="b" /></lnTo></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo></path></pathLst>';
var dm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 18750" /><gd name="adj2" fmla="val -8333" /><gd name="adj3" fmla="val 18750" /><gd name="adj4" fmla="val -16667" /><gd name="adj5" fmla="val 112500" /><gd name="adj6" fmla="val -46667" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y1" fmla="*/ h adj1 100000" /><gd name="x1" fmla="*/ w adj2 100000" /><gd name="y2" fmla="*/ h adj3 100000" /><gd name="x2" fmla="*/ w adj4 100000" /><gd name="y3" fmla="*/ h adj5 100000" /><gd name="x3" fmla="*/ w adj6 100000" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj2" minX="-2147483647" maxX="2147483647" gdRefY="adj1" minY="-2147483647" maxY="2147483647"><pos x="x1" y="y1" /></ahXY><ahXY gdRefX="adj4" minX="-2147483647" maxX="2147483647" gdRefY="adj3" minY="-2147483647" maxY="2147483647"><pos x="x2" y="y2" /></ahXY><ahXY gdRefX="adj6" minX="-2147483647" maxX="2147483647" gdRefY="adj5" minY="-2147483647" maxY="2147483647"><pos x="x3" y="y3" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="t" /></moveTo><close /><lnTo><pt x="x1" y="b" /></lnTo></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo></path></pathLst>';
var xm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 18750" /><gd name="adj2" fmla="val -8333" /><gd name="adj3" fmla="val 18750" /><gd name="adj4" fmla="val -16667" /><gd name="adj5" fmla="val 100000" /><gd name="adj6" fmla="val -16667" /><gd name="adj7" fmla="val 112963" /><gd name="adj8" fmla="val -8333" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y1" fmla="*/ h adj1 100000" /><gd name="x1" fmla="*/ w adj2 100000" /><gd name="y2" fmla="*/ h adj3 100000" /><gd name="x2" fmla="*/ w adj4 100000" /><gd name="y3" fmla="*/ h adj5 100000" /><gd name="x3" fmla="*/ w adj6 100000" /><gd name="y4" fmla="*/ h adj7 100000" /><gd name="x4" fmla="*/ w adj8 100000" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj2" minX="-2147483647" maxX="2147483647" gdRefY="adj1" minY="-2147483647" maxY="2147483647"><pos x="x1" y="y1" /></ahXY><ahXY gdRefX="adj4" minX="-2147483647" maxX="2147483647" gdRefY="adj3" minY="-2147483647" maxY="2147483647"><pos x="x2" y="y2" /></ahXY><ahXY gdRefX="adj6" minX="-2147483647" maxX="2147483647" gdRefY="adj5" minY="-2147483647" maxY="2147483647"><pos x="x3" y="y3" /></ahXY><ahXY gdRefX="adj8" minX="-2147483647" maxX="2147483647" gdRefY="adj7" minY="-2147483647" maxY="2147483647"><pos x="x4" y="y4" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="t" /></moveTo><close /><lnTo><pt x="x1" y="b" /></lnTo></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo><lnTo><pt x="x4" y="y4" /></lnTo></path></pathLst>';
var gm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 18750" /><gd name="adj2" fmla="val -8333" /><gd name="adj3" fmla="val 112500" /><gd name="adj4" fmla="val -38333" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y1" fmla="*/ h adj1 100000" /><gd name="x1" fmla="*/ w adj2 100000" /><gd name="y2" fmla="*/ h adj3 100000" /><gd name="x2" fmla="*/ w adj4 100000" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj2" minX="-2147483647" maxX="2147483647" gdRefY="adj1" minY="-2147483647" maxY="2147483647"><pos x="x1" y="y1" /></ahXY><ahXY gdRefX="adj4" minX="-2147483647" maxX="2147483647" gdRefY="adj3" minY="-2147483647" maxY="2147483647"><pos x="x2" y="y2" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="t" /></moveTo><close /><lnTo><pt x="x1" y="b" /></lnTo></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo></path></pathLst>';
var cm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 18750" /><gd name="adj2" fmla="val -8333" /><gd name="adj3" fmla="val 18750" /><gd name="adj4" fmla="val -16667" /><gd name="adj5" fmla="val 112500" /><gd name="adj6" fmla="val -46667" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y1" fmla="*/ h adj1 100000" /><gd name="x1" fmla="*/ w adj2 100000" /><gd name="y2" fmla="*/ h adj3 100000" /><gd name="x2" fmla="*/ w adj4 100000" /><gd name="y3" fmla="*/ h adj5 100000" /><gd name="x3" fmla="*/ w adj6 100000" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj2" minX="-2147483647" maxX="2147483647" gdRefY="adj1" minY="-2147483647" maxY="2147483647"><pos x="x1" y="y1" /></ahXY><ahXY gdRefX="adj4" minX="-2147483647" maxX="2147483647" gdRefY="adj3" minY="-2147483647" maxY="2147483647"><pos x="x2" y="y2" /></ahXY><ahXY gdRefX="adj6" minX="-2147483647" maxX="2147483647" gdRefY="adj5" minY="-2147483647" maxY="2147483647"><pos x="x3" y="y3" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="t" /></moveTo><close /><lnTo><pt x="x1" y="b" /></lnTo></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo></path></pathLst>';
var rm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 18750" /><gd name="adj2" fmla="val -8333" /><gd name="adj3" fmla="val 18750" /><gd name="adj4" fmla="val -16667" /><gd name="adj5" fmla="val 100000" /><gd name="adj6" fmla="val -16667" /><gd name="adj7" fmla="val 112963" /><gd name="adj8" fmla="val -8333" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y1" fmla="*/ h adj1 100000" /><gd name="x1" fmla="*/ w adj2 100000" /><gd name="y2" fmla="*/ h adj3 100000" /><gd name="x2" fmla="*/ w adj4 100000" /><gd name="y3" fmla="*/ h adj5 100000" /><gd name="x3" fmla="*/ w adj6 100000" /><gd name="y4" fmla="*/ h adj7 100000" /><gd name="x4" fmla="*/ w adj8 100000" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj2" minX="-2147483647" maxX="2147483647" gdRefY="adj1" minY="-2147483647" maxY="2147483647"><pos x="x1" y="y1" /></ahXY><ahXY gdRefX="adj4" minX="-2147483647" maxX="2147483647" gdRefY="adj3" minY="-2147483647" maxY="2147483647"><pos x="x2" y="y2" /></ahXY><ahXY gdRefX="adj6" minX="-2147483647" maxX="2147483647" gdRefY="adj5" minY="-2147483647" maxY="2147483647"><pos x="x3" y="y3" /></ahXY><ahXY gdRefX="adj8" minX="-2147483647" maxX="2147483647" gdRefY="adj7" minY="-2147483647" maxY="2147483647"><pos x="x4" y="y4" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="t" /></moveTo><close /><lnTo><pt x="x1" y="b" /></lnTo></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo><lnTo><pt x="x4" y="y4" /></lnTo></path></pathLst>';
var pm = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="dx2" fmla="*/ ss 3 8" /><gd name="g9" fmla="+- vc 0 dx2" /><gd name="g10" fmla="+- vc dx2 0" /><gd name="g11" fmla="+- hc 0 dx2" /><gd name="g12" fmla="+- hc dx2 0" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /><moveTo><pt x="g11" y="vc" /></moveTo><lnTo><pt x="g12" y="g9" /></lnTo><lnTo><pt x="g12" y="g10" /></lnTo><close /></path><path stroke="false" fill="darken" extrusionOk="false"><moveTo><pt x="g11" y="vc" /></moveTo><lnTo><pt x="g12" y="g9" /></lnTo><lnTo><pt x="g12" y="g10" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="g11" y="vc" /></moveTo><lnTo><pt x="g12" y="g9" /></lnTo><lnTo><pt x="g12" y="g10" /></lnTo><close /></path><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var im = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="dx2" fmla="*/ ss 3 8" /><gd name="g9" fmla="+- vc 0 dx2" /><gd name="g10" fmla="+- vc dx2 0" /><gd name="g11" fmla="+- hc 0 dx2" /><gd name="g12" fmla="+- hc dx2 0" /><gd name="g13" fmla="*/ ss 3 4" /><gd name="g14" fmla="*/ g13 1 8" /><gd name="g15" fmla="*/ g13 1 4" /><gd name="g16" fmla="+- g11 g14 0" /><gd name="g17" fmla="+- g11 g15 0" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /><moveTo><pt x="g17" y="vc" /></moveTo><lnTo><pt x="g12" y="g9" /></lnTo><lnTo><pt x="g12" y="g10" /></lnTo><close /><moveTo><pt x="g16" y="g9" /></moveTo><lnTo><pt x="g11" y="g9" /></lnTo><lnTo><pt x="g11" y="g10" /></lnTo><lnTo><pt x="g16" y="g10" /></lnTo><close /></path><path stroke="false" fill="darken" extrusionOk="false"><moveTo><pt x="g17" y="vc" /></moveTo><lnTo><pt x="g12" y="g9" /></lnTo><lnTo><pt x="g12" y="g10" /></lnTo><close /><moveTo><pt x="g16" y="g9" /></moveTo><lnTo><pt x="g11" y="g9" /></lnTo><lnTo><pt x="g11" y="g10" /></lnTo><lnTo><pt x="g16" y="g10" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="g17" y="vc" /></moveTo><lnTo><pt x="g12" y="g9" /></lnTo><lnTo><pt x="g12" y="g10" /></lnTo><close /><moveTo><pt x="g16" y="g9" /></moveTo><lnTo><pt x="g16" y="g10" /></lnTo><lnTo><pt x="g11" y="g10" /></lnTo><lnTo><pt x="g11" y="g9" /></lnTo><close /></path><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var fm = '<cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var hm = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="dx2" fmla="*/ ss 3 8" /><gd name="g9" fmla="+- vc 0 dx2" /><gd name="g10" fmla="+- vc dx2 0" /><gd name="dx1" fmla="*/ ss 9 32" /><gd name="g11" fmla="+- hc 0 dx1" /><gd name="g12" fmla="+- hc dx1 0" /><gd name="g13" fmla="*/ ss 3 16" /><gd name="g14" fmla="+- g12 0 g13" /><gd name="g15" fmla="+- g9 g13 0" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /><moveTo><pt x="g11" y="g9" /></moveTo><lnTo><pt x="g14" y="g9" /></lnTo><lnTo><pt x="g12" y="g15" /></lnTo><lnTo><pt x="g12" y="g10" /></lnTo><lnTo><pt x="g11" y="g10" /></lnTo><close /></path><path stroke="false" fill="darkenLess" extrusionOk="false"><moveTo><pt x="g11" y="g9" /></moveTo><lnTo><pt x="g14" y="g9" /></lnTo><lnTo><pt x="g14" y="g15" /></lnTo><lnTo><pt x="g12" y="g15" /></lnTo><lnTo><pt x="g12" y="g10" /></lnTo><lnTo><pt x="g11" y="g10" /></lnTo><close /></path><path stroke="false" fill="darken" extrusionOk="false"><moveTo><pt x="g14" y="g9" /></moveTo><lnTo><pt x="g14" y="g15" /></lnTo><lnTo><pt x="g12" y="g15" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="g11" y="g9" /></moveTo><lnTo><pt x="g14" y="g9" /></lnTo><lnTo><pt x="g12" y="g15" /></lnTo><lnTo><pt x="g12" y="g10" /></lnTo><lnTo><pt x="g11" y="g10" /></lnTo><close /><moveTo><pt x="g12" y="g15" /></moveTo><lnTo><pt x="g14" y="g15" /></lnTo><lnTo><pt x="g14" y="g9" /></lnTo></path><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var ym = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="dx2" fmla="*/ ss 3 8" /><gd name="g9" fmla="+- vc 0 dx2" /><gd name="g10" fmla="+- vc dx2 0" /><gd name="g11" fmla="+- hc 0 dx2" /><gd name="g12" fmla="+- hc dx2 0" /><gd name="g13" fmla="*/ ss 3 4" /><gd name="g14" fmla="*/ g13 3 4" /><gd name="g15" fmla="*/ g13 7 8" /><gd name="g16" fmla="+- g11 g14 0" /><gd name="g17" fmla="+- g11 g15 0" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /><moveTo><pt x="g16" y="vc" /></moveTo><lnTo><pt x="g11" y="g9" /></lnTo><lnTo><pt x="g11" y="g10" /></lnTo><close /><moveTo><pt x="g17" y="g9" /></moveTo><lnTo><pt x="g12" y="g9" /></lnTo><lnTo><pt x="g12" y="g10" /></lnTo><lnTo><pt x="g17" y="g10" /></lnTo><close /></path><path stroke="false" fill="darken" extrusionOk="false"><moveTo><pt x="g16" y="vc" /></moveTo><lnTo><pt x="g11" y="g9" /></lnTo><lnTo><pt x="g11" y="g10" /></lnTo><close /><moveTo><pt x="g17" y="g9" /></moveTo><lnTo><pt x="g12" y="g9" /></lnTo><lnTo><pt x="g12" y="g10" /></lnTo><lnTo><pt x="g17" y="g10" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="g16" y="vc" /></moveTo><lnTo><pt x="g11" y="g10" /></lnTo><lnTo><pt x="g11" y="g9" /></lnTo><close /><moveTo><pt x="g17" y="g9" /></moveTo><lnTo><pt x="g12" y="g9" /></lnTo><lnTo><pt x="g12" y="g10" /></lnTo><lnTo><pt x="g17" y="g10" /></lnTo><close /></path><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var Tm = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="dx2" fmla="*/ ss 3 8" /><gd name="g9" fmla="+- vc 0 dx2" /><gd name="g10" fmla="+- vc dx2 0" /><gd name="g11" fmla="+- hc 0 dx2" /><gd name="g12" fmla="+- hc dx2 0" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /><moveTo><pt x="g12" y="vc" /></moveTo><lnTo><pt x="g11" y="g9" /></lnTo><lnTo><pt x="g11" y="g10" /></lnTo><close /></path><path stroke="false" fill="darken" extrusionOk="false"><moveTo><pt x="g12" y="vc" /></moveTo><lnTo><pt x="g11" y="g9" /></lnTo><lnTo><pt x="g11" y="g10" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="g12" y="vc" /></moveTo><lnTo><pt x="g11" y="g10" /></lnTo><lnTo><pt x="g11" y="g9" /></lnTo><close /></path><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var wm = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="dx2" fmla="*/ ss 3 8" /><gd name="g9" fmla="+- vc 0 dx2" /><gd name="g11" fmla="+- hc 0 dx2" /><gd name="g13" fmla="*/ ss 3 4" /><gd name="g14" fmla="*/ g13 1 7" /><gd name="g15" fmla="*/ g13 3 14" /><gd name="g16" fmla="*/ g13 2 7" /><gd name="g19" fmla="*/ g13 3 7" /><gd name="g20" fmla="*/ g13 4 7" /><gd name="g21" fmla="*/ g13 17 28" /><gd name="g23" fmla="*/ g13 21 28" /><gd name="g24" fmla="*/ g13 11 14" /><gd name="g27" fmla="+- g9 g16 0" /><gd name="g29" fmla="+- g9 g21 0" /><gd name="g30" fmla="+- g9 g23 0" /><gd name="g31" fmla="+- g9 g24 0" /><gd name="g33" fmla="+- g11 g15 0" /><gd name="g36" fmla="+- g11 g19 0" /><gd name="g37" fmla="+- g11 g20 0" /><gd name="g41" fmla="*/ g13 1 14" /><gd name="g42" fmla="*/ g13 3 28" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /><moveTo><pt x="g33" y="g27" /></moveTo><arcTo wR="g16" hR="g16" stAng="cd2" swAng="cd2" /><arcTo wR="g14" hR="g15" stAng="0" swAng="cd4" /><arcTo wR="g41" hR="g42" stAng="3cd4" swAng="-5400000" /><lnTo><pt x="g37" y="g30" /></lnTo><lnTo><pt x="g36" y="g30" /></lnTo><lnTo><pt x="g36" y="g29" /></lnTo><arcTo wR="g14" hR="g15" stAng="cd2" swAng="cd4" /><arcTo wR="g41" hR="g42" stAng="cd4" swAng="-5400000" /><arcTo wR="g14" hR="g14" stAng="0" swAng="-10800000" /><close /><moveTo><pt x="hc" y="g31" /></moveTo><arcTo wR="g42" hR="g42" stAng="3cd4" swAng="21600000" /><close /></path><path stroke="false" fill="darken" extrusionOk="false"><moveTo><pt x="g33" y="g27" /></moveTo><arcTo wR="g16" hR="g16" stAng="cd2" swAng="cd2" /><arcTo wR="g14" hR="g15" stAng="0" swAng="cd4" /><arcTo wR="g41" hR="g42" stAng="3cd4" swAng="-5400000" /><lnTo><pt x="g37" y="g30" /></lnTo><lnTo><pt x="g36" y="g30" /></lnTo><lnTo><pt x="g36" y="g29" /></lnTo><arcTo wR="g14" hR="g15" stAng="cd2" swAng="cd4" /><arcTo wR="g41" hR="g42" stAng="cd4" swAng="-5400000" /><arcTo wR="g14" hR="g14" stAng="0" swAng="-10800000" /><close /><moveTo><pt x="hc" y="g31" /></moveTo><arcTo wR="g42" hR="g42" stAng="3cd4" swAng="21600000" /><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="g33" y="g27" /></moveTo><arcTo wR="g16" hR="g16" stAng="cd2" swAng="cd2" /><arcTo wR="g14" hR="g15" stAng="0" swAng="cd4" /><arcTo wR="g41" hR="g42" stAng="3cd4" swAng="-5400000" /><lnTo><pt x="g37" y="g30" /></lnTo><lnTo><pt x="g36" y="g30" /></lnTo><lnTo><pt x="g36" y="g29" /></lnTo><arcTo wR="g14" hR="g15" stAng="cd2" swAng="cd4" /><arcTo wR="g41" hR="g42" stAng="cd4" swAng="-5400000" /><arcTo wR="g14" hR="g14" stAng="0" swAng="-10800000" /><close /><moveTo><pt x="hc" y="g31" /></moveTo><arcTo wR="g42" hR="g42" stAng="3cd4" swAng="21600000" /><close /></path><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var vm = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="dx2" fmla="*/ ss 3 8" /><gd name="g9" fmla="+- vc 0 dx2" /><gd name="g10" fmla="+- vc dx2 0" /><gd name="g11" fmla="+- hc 0 dx2" /><gd name="g12" fmla="+- hc dx2 0" /><gd name="g13" fmla="*/ ss 3 4" /><gd name="g14" fmla="*/ g13 1 16" /><gd name="g15" fmla="*/ g13 1 8" /><gd name="g16" fmla="*/ g13 3 16" /><gd name="g17" fmla="*/ g13 5 16" /><gd name="g18" fmla="*/ g13 7 16" /><gd name="g19" fmla="*/ g13 9 16" /><gd name="g20" fmla="*/ g13 11 16" /><gd name="g21" fmla="*/ g13 3 4" /><gd name="g22" fmla="*/ g13 13 16" /><gd name="g23" fmla="*/ g13 7 8" /><gd name="g24" fmla="+- g9 g14 0" /><gd name="g25" fmla="+- g9 g16 0" /><gd name="g26" fmla="+- g9 g17 0" /><gd name="g27" fmla="+- g9 g21 0" /><gd name="g28" fmla="+- g11 g15 0" /><gd name="g29" fmla="+- g11 g18 0" /><gd name="g30" fmla="+- g11 g19 0" /><gd name="g31" fmla="+- g11 g20 0" /><gd name="g32" fmla="+- g11 g22 0" /><gd name="g33" fmla="+- g11 g23 0" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /><moveTo><pt x="hc" y="g9" /></moveTo><lnTo><pt x="g11" y="vc" /></lnTo><lnTo><pt x="g28" y="vc" /></lnTo><lnTo><pt x="g28" y="g10" /></lnTo><lnTo><pt x="g33" y="g10" /></lnTo><lnTo><pt x="g33" y="vc" /></lnTo><lnTo><pt x="g12" y="vc" /></lnTo><lnTo><pt x="g32" y="g26" /></lnTo><lnTo><pt x="g32" y="g24" /></lnTo><lnTo><pt x="g31" y="g24" /></lnTo><lnTo><pt x="g31" y="g25" /></lnTo><close /></path><path stroke="false" fill="darkenLess" extrusionOk="false"><moveTo><pt x="g32" y="g26" /></moveTo><lnTo><pt x="g32" y="g24" /></lnTo><lnTo><pt x="g31" y="g24" /></lnTo><lnTo><pt x="g31" y="g25" /></lnTo><close /><moveTo><pt x="g28" y="vc" /></moveTo><lnTo><pt x="g28" y="g10" /></lnTo><lnTo><pt x="g29" y="g10" /></lnTo><lnTo><pt x="g29" y="g27" /></lnTo><lnTo><pt x="g30" y="g27" /></lnTo><lnTo><pt x="g30" y="g10" /></lnTo><lnTo><pt x="g33" y="g10" /></lnTo><lnTo><pt x="g33" y="vc" /></lnTo><close /></path><path stroke="false" fill="darken" extrusionOk="false"><moveTo><pt x="hc" y="g9" /></moveTo><lnTo><pt x="g11" y="vc" /></lnTo><lnTo><pt x="g12" y="vc" /></lnTo><close /><moveTo><pt x="g29" y="g27" /></moveTo><lnTo><pt x="g30" y="g27" /></lnTo><lnTo><pt x="g30" y="g10" /></lnTo><lnTo><pt x="g29" y="g10" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="hc" y="g9" /></moveTo><lnTo><pt x="g31" y="g25" /></lnTo><lnTo><pt x="g31" y="g24" /></lnTo><lnTo><pt x="g32" y="g24" /></lnTo><lnTo><pt x="g32" y="g26" /></lnTo><lnTo><pt x="g12" y="vc" /></lnTo><lnTo><pt x="g33" y="vc" /></lnTo><lnTo><pt x="g33" y="g10" /></lnTo><lnTo><pt x="g28" y="g10" /></lnTo><lnTo><pt x="g28" y="vc" /></lnTo><lnTo><pt x="g11" y="vc" /></lnTo><close /><moveTo><pt x="g31" y="g25" /></moveTo><lnTo><pt x="g32" y="g26" /></lnTo><moveTo><pt x="g33" y="vc" /></moveTo><lnTo><pt x="g28" y="vc" /></lnTo><moveTo><pt x="g29" y="g10" /></moveTo><lnTo><pt x="g29" y="g27" /></lnTo><lnTo><pt x="g30" y="g27" /></lnTo><lnTo><pt x="g30" y="g10" /></lnTo></path><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var Lm = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="dx2" fmla="*/ ss 3 8" /><gd name="g9" fmla="+- vc 0 dx2" /><gd name="g11" fmla="+- hc 0 dx2" /><gd name="g13" fmla="*/ ss 3 4" /><gd name="g14" fmla="*/ g13 1 32" /><gd name="g17" fmla="*/ g13 5 16" /><gd name="g18" fmla="*/ g13 3 8" /><gd name="g19" fmla="*/ g13 13 32" /><gd name="g20" fmla="*/ g13 19 32" /><gd name="g22" fmla="*/ g13 11 16" /><gd name="g23" fmla="*/ g13 13 16" /><gd name="g24" fmla="*/ g13 7 8" /><gd name="g25" fmla="+- g9 g14 0" /><gd name="g28" fmla="+- g9 g17 0" /><gd name="g29" fmla="+- g9 g18 0" /><gd name="g30" fmla="+- g9 g23 0" /><gd name="g31" fmla="+- g9 g24 0" /><gd name="g32" fmla="+- g11 g17 0" /><gd name="g34" fmla="+- g11 g19 0" /><gd name="g35" fmla="+- g11 g20 0" /><gd name="g37" fmla="+- g11 g22 0" /><gd name="g38" fmla="*/ g13 3 32" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /><moveTo><pt x="hc" y="g9" /></moveTo><arcTo wR="dx2" hR="dx2" stAng="3cd4" swAng="21600000" /><close /></path><path stroke="false" fill="darken" extrusionOk="false"><moveTo><pt x="hc" y="g9" /></moveTo><arcTo wR="dx2" hR="dx2" stAng="3cd4" swAng="21600000" /><close /><moveTo><pt x="hc" y="g25" /></moveTo><arcTo wR="g38" hR="g38" stAng="3cd4" swAng="21600000" /><moveTo><pt x="g32" y="g28" /></moveTo><lnTo><pt x="g32" y="g29" /></lnTo><lnTo><pt x="g34" y="g29" /></lnTo><lnTo><pt x="g34" y="g30" /></lnTo><lnTo><pt x="g32" y="g30" /></lnTo><lnTo><pt x="g32" y="g31" /></lnTo><lnTo><pt x="g37" y="g31" /></lnTo><lnTo><pt x="g37" y="g30" /></lnTo><lnTo><pt x="g35" y="g30" /></lnTo><lnTo><pt x="g35" y="g28" /></lnTo><close /></path><path stroke="false" fill="lighten" extrusionOk="false"><moveTo><pt x="hc" y="g25" /></moveTo><arcTo wR="g38" hR="g38" stAng="3cd4" swAng="21600000" /><moveTo><pt x="g32" y="g28" /></moveTo><lnTo><pt x="g35" y="g28" /></lnTo><lnTo><pt x="g35" y="g30" /></lnTo><lnTo><pt x="g37" y="g30" /></lnTo><lnTo><pt x="g37" y="g31" /></lnTo><lnTo><pt x="g32" y="g31" /></lnTo><lnTo><pt x="g32" y="g30" /></lnTo><lnTo><pt x="g34" y="g30" /></lnTo><lnTo><pt x="g34" y="g29" /></lnTo><lnTo><pt x="g32" y="g29" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="hc" y="g9" /></moveTo><arcTo wR="dx2" hR="dx2" stAng="3cd4" swAng="21600000" /><close /><moveTo><pt x="hc" y="g25" /></moveTo><arcTo wR="g38" hR="g38" stAng="3cd4" swAng="21600000" /><moveTo><pt x="g32" y="g28" /></moveTo><lnTo><pt x="g35" y="g28" /></lnTo><lnTo><pt x="g35" y="g30" /></lnTo><lnTo><pt x="g37" y="g30" /></lnTo><lnTo><pt x="g37" y="g31" /></lnTo><lnTo><pt x="g32" y="g31" /></lnTo><lnTo><pt x="g32" y="g30" /></lnTo><lnTo><pt x="g34" y="g30" /></lnTo><lnTo><pt x="g34" y="g29" /></lnTo><lnTo><pt x="g32" y="g29" /></lnTo><close /></path><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var um = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="dx2" fmla="*/ ss 3 8" /><gd name="g9" fmla="+- vc 0 dx2" /><gd name="g10" fmla="+- vc dx2 0" /><gd name="g11" fmla="+- hc 0 dx2" /><gd name="g12" fmla="+- hc dx2 0" /><gd name="g13" fmla="*/ ss 3 4" /><gd name="g14" fmla="*/ g13 1455 21600" /><gd name="g15" fmla="*/ g13 1905 21600" /><gd name="g16" fmla="*/ g13 2325 21600" /><gd name="g17" fmla="*/ g13 16155 21600" /><gd name="g18" fmla="*/ g13 17010 21600" /><gd name="g19" fmla="*/ g13 19335 21600" /><gd name="g20" fmla="*/ g13 19725 21600" /><gd name="g21" fmla="*/ g13 20595 21600" /><gd name="g22" fmla="*/ g13 5280 21600" /><gd name="g23" fmla="*/ g13 5730 21600" /><gd name="g24" fmla="*/ g13 6630 21600" /><gd name="g25" fmla="*/ g13 7492 21600" /><gd name="g26" fmla="*/ g13 9067 21600" /><gd name="g27" fmla="*/ g13 9555 21600" /><gd name="g28" fmla="*/ g13 13342 21600" /><gd name="g29" fmla="*/ g13 14580 21600" /><gd name="g30" fmla="*/ g13 15592 21600" /><gd name="g31" fmla="+- g11 g14 0" /><gd name="g32" fmla="+- g11 g15 0" /><gd name="g33" fmla="+- g11 g16 0" /><gd name="g34" fmla="+- g11 g17 0" /><gd name="g35" fmla="+- g11 g18 0" /><gd name="g36" fmla="+- g11 g19 0" /><gd name="g37" fmla="+- g11 g20 0" /><gd name="g38" fmla="+- g11 g21 0" /><gd name="g39" fmla="+- g9 g22 0" /><gd name="g40" fmla="+- g9 g23 0" /><gd name="g41" fmla="+- g9 g24 0" /><gd name="g42" fmla="+- g9 g25 0" /><gd name="g43" fmla="+- g9 g26 0" /><gd name="g44" fmla="+- g9 g27 0" /><gd name="g45" fmla="+- g9 g28 0" /><gd name="g46" fmla="+- g9 g29 0" /><gd name="g47" fmla="+- g9 g30 0" /><gd name="g48" fmla="+- g9 g31 0" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /><moveTo><pt x="g11" y="g39" /></moveTo><lnTo><pt x="g11" y="g44" /></lnTo><lnTo><pt x="g31" y="g44" /></lnTo><lnTo><pt x="g32" y="g43" /></lnTo><lnTo><pt x="g33" y="g43" /></lnTo><lnTo><pt x="g33" y="g47" /></lnTo><lnTo><pt x="g35" y="g47" /></lnTo><lnTo><pt x="g35" y="g45" /></lnTo><lnTo><pt x="g36" y="g45" /></lnTo><lnTo><pt x="g38" y="g46" /></lnTo><lnTo><pt x="g12" y="g46" /></lnTo><lnTo><pt x="g12" y="g41" /></lnTo><lnTo><pt x="g38" y="g41" /></lnTo><lnTo><pt x="g37" y="g42" /></lnTo><lnTo><pt x="g35" y="g42" /></lnTo><lnTo><pt x="g35" y="g41" /></lnTo><lnTo><pt x="g34" y="g40" /></lnTo><lnTo><pt x="g32" y="g40" /></lnTo><lnTo><pt x="g31" y="g39" /></lnTo><close /></path><path stroke="false" fill="darken" extrusionOk="false"><moveTo><pt x="g11" y="g39" /></moveTo><lnTo><pt x="g11" y="g44" /></lnTo><lnTo><pt x="g31" y="g44" /></lnTo><lnTo><pt x="g32" y="g43" /></lnTo><lnTo><pt x="g33" y="g43" /></lnTo><lnTo><pt x="g33" y="g47" /></lnTo><lnTo><pt x="g35" y="g47" /></lnTo><lnTo><pt x="g35" y="g45" /></lnTo><lnTo><pt x="g36" y="g45" /></lnTo><lnTo><pt x="g38" y="g46" /></lnTo><lnTo><pt x="g12" y="g46" /></lnTo><lnTo><pt x="g12" y="g41" /></lnTo><lnTo><pt x="g38" y="g41" /></lnTo><lnTo><pt x="g37" y="g42" /></lnTo><lnTo><pt x="g35" y="g42" /></lnTo><lnTo><pt x="g35" y="g41" /></lnTo><lnTo><pt x="g34" y="g40" /></lnTo><lnTo><pt x="g32" y="g40" /></lnTo><lnTo><pt x="g31" y="g39" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="g11" y="g39" /></moveTo><lnTo><pt x="g31" y="g39" /></lnTo><lnTo><pt x="g32" y="g40" /></lnTo><lnTo><pt x="g34" y="g40" /></lnTo><lnTo><pt x="g35" y="g41" /></lnTo><lnTo><pt x="g35" y="g42" /></lnTo><lnTo><pt x="g37" y="g42" /></lnTo><lnTo><pt x="g38" y="g41" /></lnTo><lnTo><pt x="g12" y="g41" /></lnTo><lnTo><pt x="g12" y="g46" /></lnTo><lnTo><pt x="g38" y="g46" /></lnTo><lnTo><pt x="g36" y="g45" /></lnTo><lnTo><pt x="g35" y="g45" /></lnTo><lnTo><pt x="g35" y="g47" /></lnTo><lnTo><pt x="g33" y="g47" /></lnTo><lnTo><pt x="g33" y="g43" /></lnTo><lnTo><pt x="g32" y="g43" /></lnTo><lnTo><pt x="g31" y="g44" /></lnTo><lnTo><pt x="g11" y="g44" /></lnTo><close /></path><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var Am = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="dx2" fmla="*/ ss 3 8" /><gd name="g9" fmla="+- vc 0 dx2" /><gd name="g10" fmla="+- vc dx2 0" /><gd name="g11" fmla="+- hc 0 dx2" /><gd name="g12" fmla="+- hc dx2 0" /><gd name="g13" fmla="*/ ss 3 4" /><gd name="g14" fmla="*/ g13 7 8" /><gd name="g15" fmla="*/ g13 3 4" /><gd name="g16" fmla="*/ g13 5 8" /><gd name="g17" fmla="*/ g13 3 8" /><gd name="g18" fmla="*/ g13 1 4" /><gd name="g19" fmla="+- g9 g15 0" /><gd name="g20" fmla="+- g9 g16 0" /><gd name="g21" fmla="+- g9 g18 0" /><gd name="g22" fmla="+- g11 g14 0" /><gd name="g23" fmla="+- g11 g15 0" /><gd name="g24" fmla="+- g11 g16 0" /><gd name="g25" fmla="+- g11 g17 0" /><gd name="g26" fmla="+- g11 g18 0" /><gd name="g27" fmla="*/ g13 1 8" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /><moveTo><pt x="g12" y="g21" /></moveTo><lnTo><pt x="g23" y="g9" /></lnTo><lnTo><pt x="hc" y="g21" /></lnTo><lnTo><pt x="g24" y="g21" /></lnTo><lnTo><pt x="g24" y="g20" /></lnTo><arcTo wR="g27" hR="g27" stAng="0" swAng="cd4" /><lnTo><pt x="g25" y="g19" /></lnTo><arcTo wR="g27" hR="g27" stAng="cd4" swAng="cd4" /><lnTo><pt x="g26" y="g21" /></lnTo><lnTo><pt x="g11" y="g21" /></lnTo><lnTo><pt x="g11" y="g20" /></lnTo><arcTo wR="g17" hR="g17" stAng="cd2" swAng="-5400000" /><lnTo><pt x="hc" y="g10" /></lnTo><arcTo wR="g17" hR="g17" stAng="cd4" swAng="-5400000" /><lnTo><pt x="g22" y="g21" /></lnTo><close /></path><path stroke="false" fill="darken" extrusionOk="false"><moveTo><pt x="g12" y="g21" /></moveTo><lnTo><pt x="g23" y="g9" /></lnTo><lnTo><pt x="hc" y="g21" /></lnTo><lnTo><pt x="g24" y="g21" /></lnTo><lnTo><pt x="g24" y="g20" /></lnTo><arcTo wR="g27" hR="g27" stAng="0" swAng="cd4" /><lnTo><pt x="g25" y="g19" /></lnTo><arcTo wR="g27" hR="g27" stAng="cd4" swAng="cd4" /><lnTo><pt x="g26" y="g21" /></lnTo><lnTo><pt x="g11" y="g21" /></lnTo><lnTo><pt x="g11" y="g20" /></lnTo><arcTo wR="g17" hR="g17" stAng="cd2" swAng="-5400000" /><lnTo><pt x="hc" y="g10" /></lnTo><arcTo wR="g17" hR="g17" stAng="cd4" swAng="-5400000" /><lnTo><pt x="g22" y="g21" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="g12" y="g21" /></moveTo><lnTo><pt x="g22" y="g21" /></lnTo><lnTo><pt x="g22" y="g20" /></lnTo><arcTo wR="g17" hR="g17" stAng="0" swAng="cd4" /><lnTo><pt x="g25" y="g10" /></lnTo><arcTo wR="g17" hR="g17" stAng="cd4" swAng="cd4" /><lnTo><pt x="g11" y="g21" /></lnTo><lnTo><pt x="g26" y="g21" /></lnTo><lnTo><pt x="g26" y="g20" /></lnTo><arcTo wR="g27" hR="g27" stAng="cd2" swAng="-5400000" /><lnTo><pt x="hc" y="g19" /></lnTo><arcTo wR="g27" hR="g27" stAng="cd4" swAng="-5400000" /><lnTo><pt x="g24" y="g21" /></lnTo><lnTo><pt x="hc" y="g21" /></lnTo><lnTo><pt x="g23" y="g9" /></lnTo><close /></path><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var bm = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="dx2" fmla="*/ ss 3 8" /><gd name="g9" fmla="+- vc 0 dx2" /><gd name="g10" fmla="+- vc dx2 0" /><gd name="g11" fmla="+- hc 0 dx2" /><gd name="g12" fmla="+- hc dx2 0" /><gd name="g13" fmla="*/ ss 3 4" /><gd name="g14" fmla="*/ g13 1 8" /><gd name="g15" fmla="*/ g13 5 16" /><gd name="g16" fmla="*/ g13 5 8" /><gd name="g17" fmla="*/ g13 11 16" /><gd name="g18" fmla="*/ g13 3 4" /><gd name="g19" fmla="*/ g13 7 8" /><gd name="g20" fmla="+- g9 g14 0" /><gd name="g21" fmla="+- g9 g15 0" /><gd name="g22" fmla="+- g9 g17 0" /><gd name="g23" fmla="+- g9 g19 0" /><gd name="g24" fmla="+- g11 g15 0" /><gd name="g25" fmla="+- g11 g16 0" /><gd name="g26" fmla="+- g11 g18 0" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /><moveTo><pt x="g11" y="g21" /></moveTo><lnTo><pt x="g11" y="g22" /></lnTo><lnTo><pt x="g24" y="g22" /></lnTo><lnTo><pt x="g25" y="g10" /></lnTo><lnTo><pt x="g25" y="g9" /></lnTo><lnTo><pt x="g24" y="g21" /></lnTo><close /></path><path stroke="false" fill="darken" extrusionOk="false"><moveTo><pt x="g11" y="g21" /></moveTo><lnTo><pt x="g11" y="g22" /></lnTo><lnTo><pt x="g24" y="g22" /></lnTo><lnTo><pt x="g25" y="g10" /></lnTo><lnTo><pt x="g25" y="g9" /></lnTo><lnTo><pt x="g24" y="g21" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="g11" y="g21" /></moveTo><lnTo><pt x="g24" y="g21" /></lnTo><lnTo><pt x="g25" y="g9" /></lnTo><lnTo><pt x="g25" y="g10" /></lnTo><lnTo><pt x="g24" y="g22" /></lnTo><lnTo><pt x="g11" y="g22" /></lnTo><close /><moveTo><pt x="g26" y="g21" /></moveTo><lnTo><pt x="g12" y="g20" /></lnTo><moveTo><pt x="g26" y="vc" /></moveTo><lnTo><pt x="g12" y="vc" /></lnTo><moveTo><pt x="g26" y="g22" /></moveTo><lnTo><pt x="g12" y="g23" /></lnTo></path><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var jm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 16200000" /><gd name="adj2" fmla="val 0" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="stAng" fmla="pin 0 adj1 21599999" /><gd name="enAng" fmla="pin 0 adj2 21599999" /><gd name="sw11" fmla="+- enAng 0 stAng" /><gd name="sw12" fmla="+- sw11 21600000 0" /><gd name="swAng" fmla="?: sw11 sw11 sw12" /><gd name="wt1" fmla="sin wd2 stAng" /><gd name="ht1" fmla="cos hd2 stAng" /><gd name="dx1" fmla="cat2 wd2 ht1 wt1" /><gd name="dy1" fmla="sat2 hd2 ht1 wt1" /><gd name="wt2" fmla="sin wd2 enAng" /><gd name="ht2" fmla="cos hd2 enAng" /><gd name="dx2" fmla="cat2 wd2 ht2 wt2" /><gd name="dy2" fmla="sat2 hd2 ht2 wt2" /><gd name="x1" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc dy1 0" /><gd name="x2" fmla="+- hc dx2 0" /><gd name="y2" fmla="+- vc dy2 0" /><gd name="sw0" fmla="+- 21600000 0 stAng" /><gd name="da1" fmla="+- swAng 0 sw0" /><gd name="g1" fmla="max x1 x2" /><gd name="ir" fmla="?: da1 r g1" /><gd name="sw1" fmla="+- cd4 0 stAng" /><gd name="sw2" fmla="+- 27000000 0 stAng" /><gd name="sw3" fmla="?: sw1 sw1 sw2" /><gd name="da2" fmla="+- swAng 0 sw3" /><gd name="g5" fmla="max y1 y2" /><gd name="ib" fmla="?: da2 b g5" /><gd name="sw4" fmla="+- cd2 0 stAng" /><gd name="sw5" fmla="+- 32400000 0 stAng" /><gd name="sw6" fmla="?: sw4 sw4 sw5" /><gd name="da3" fmla="+- swAng 0 sw6" /><gd name="g9" fmla="min x1 x2" /><gd name="il" fmla="?: da3 l g9" /><gd name="sw7" fmla="+- 3cd4 0 stAng" /><gd name="sw8" fmla="+- 37800000 0 stAng" /><gd name="sw9" fmla="?: sw7 sw7 sw8" /><gd name="da4" fmla="+- swAng 0 sw9" /><gd name="g13" fmla="min y1 y2" /><gd name="it" fmla="?: da4 t g13" /><gd name="cang1" fmla="+- stAng 0 cd4" /><gd name="cang2" fmla="+- enAng cd4 0" /><gd name="cang3" fmla="+/ cang1 cang2 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefAng="adj1" minAng="0" maxAng="21599999"><pos x="x1" y="y1" /></ahPolar><ahPolar gdRefAng="adj2" minAng="0" maxAng="21599999"><pos x="x2" y="y2" /></ahPolar></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cang1"><pos x="x1" y="y1" /></cxn><cxn ang="cang3"><pos x="hc" y="vc" /></cxn><cxn ang="cang2"><pos x="x2" y="y2" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="x1" y="y1" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="stAng" swAng="swAng" /><lnTo><pt x="hc" y="vc" /></lnTo><close /></path><path fill="none"><moveTo><pt x="x1" y="y1" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="stAng" swAng="swAng" /></path></pathLst>';
var $m = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 25000" /><gd name="adj3" fmla="val 25000" /><gd name="adj4" fmla="val 43750" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a2" fmla="pin 0 adj2 50000" /><gd name="maxAdj1" fmla="*/ a2 2 1" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="a3" fmla="pin 0 adj3 50000" /><gd name="th" fmla="*/ ss a1 100000" /><gd name="aw2" fmla="*/ ss a2 100000" /><gd name="th2" fmla="*/ th 1 2" /><gd name="dh2" fmla="+- aw2 0 th2" /><gd name="ah" fmla="*/ ss a3 100000" /><gd name="bw" fmla="+- r 0 ah" /><gd name="bh" fmla="+- b 0 dh2" /><gd name="bs" fmla="min bw bh" /><gd name="maxAdj4" fmla="*/ 100000 bs ss" /><gd name="a4" fmla="pin 0 adj4 maxAdj4" /><gd name="bd" fmla="*/ ss a4 100000" /><gd name="bd3" fmla="+- bd 0 th" /><gd name="bd2" fmla="max bd3 0" /><gd name="x3" fmla="+- th bd2 0" /><gd name="x4" fmla="+- r 0 ah" /><gd name="y3" fmla="+- dh2 th 0" /><gd name="y4" fmla="+- y3 dh2 0" /><gd name="y5" fmla="+- dh2 bd 0" /><gd name="y6" fmla="+- y3 bd2 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="maxAdj1"><pos x="th" y="b" /></ahXY><ahXY gdRefY="adj2" minY="0" maxY="50000"><pos x="r" y="y4" /></ahXY><ahXY gdRefX="adj3" minX="0" maxX="50000"><pos x="x4" y="t" /></ahXY><ahXY gdRefX="adj4" minX="0" maxX="maxAdj4"><pos x="bd" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x4" y="t" /></cxn><cxn ang="cd4"><pos x="x4" y="y4" /></cxn><cxn ang="cd4"><pos x="th2" y="b" /></cxn><cxn ang="0"><pos x="r" y="aw2" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="l" y="y5" /></lnTo><arcTo wR="bd" hR="bd" stAng="cd2" swAng="cd4" /><lnTo><pt x="x4" y="dh2" /></lnTo><lnTo><pt x="x4" y="t" /></lnTo><lnTo><pt x="r" y="aw2" /></lnTo><lnTo><pt x="x4" y="y4" /></lnTo><lnTo><pt x="x4" y="y3" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo><arcTo wR="bd2" hR="bd2" stAng="3cd4" swAng="-5400000" /><lnTo><pt x="th" y="b" /></lnTo><close /></path></pathLst>';
var Rm = '<rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo></path></pathLst>';
var Ym = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x1" fmla="*/ w adj1 100000" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="-2147483647" maxX="2147483647"><pos x="x1" y="vc" /></ahXY></ahLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="x1" y="t" /></lnTo><lnTo><pt x="x1" y="b" /></lnTo><lnTo><pt x="r" y="b" /></lnTo></path></pathLst>';
var Xm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 50000" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x1" fmla="*/ w adj1 100000" /><gd name="x2" fmla="+/ x1 r 2" /><gd name="y2" fmla="*/ h adj2 100000" /><gd name="y1" fmla="+/ t y2 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="-2147483647" maxX="2147483647"><pos x="x1" y="y1" /></ahXY><ahXY gdRefY="adj2" minY="-2147483647" maxY="2147483647"><pos x="x2" y="y2" /></ahXY></ahLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="x1" y="t" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><lnTo><pt x="r" y="y2" /></lnTo><lnTo><pt x="r" y="b" /></lnTo></path></pathLst>';
var Cm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 50000" /><gd name="adj2" fmla="val 50000" /><gd name="adj3" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x1" fmla="*/ w adj1 100000" /><gd name="x3" fmla="*/ w adj3 100000" /><gd name="x2" fmla="+/ x1 x3 2" /><gd name="y2" fmla="*/ h adj2 100000" /><gd name="y1" fmla="+/ t y2 2" /><gd name="y3" fmla="+/ b y2 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="-2147483647" maxX="2147483647"><pos x="x1" y="y1" /></ahXY><ahXY gdRefY="adj2" minY="-2147483647" maxY="2147483647"><pos x="x2" y="y2" /></ahXY><ahXY gdRefX="adj3" minX="-2147483647" maxX="2147483647"><pos x="x3" y="y3" /></ahXY></ahLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="x1" y="t" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><lnTo><pt x="x3" y="y2" /></lnTo><lnTo><pt x="x3" y="b" /></lnTo><lnTo><pt x="r" y="b" /></lnTo></path></pathLst>';
var Fm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 25000" /><gd name="adj3" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 50000" /><gd name="a2" fmla="pin 0 adj2 50000" /><gd name="a3" fmla="pin 0 adj3 50000" /><gd name="y1" fmla="*/ ss a3 100000" /><gd name="dx1" fmla="*/ ss a2 50000" /><gd name="x1" fmla="+- r 0 dx1" /><gd name="dx3" fmla="*/ ss a2 100000" /><gd name="x3" fmla="+- r 0 dx3" /><gd name="dx2" fmla="*/ ss a1 200000" /><gd name="x2" fmla="+- x3 0 dx2" /><gd name="x4" fmla="+- x3 dx2 0" /><gd name="dy2" fmla="*/ ss a1 100000" /><gd name="y2" fmla="+- b 0 dy2" /><gd name="x0" fmla="*/ x4 1 2" /><gd name="y3" fmla="+/ y2 b 2" /><gd name="y15" fmla="+/ y1 b 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="50000"><pos x="l" y="y2" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="50000"><pos x="x1" y="t" /></ahXY><ahXY gdRefY="adj3" minY="0" maxY="50000"><pos x="x2" y="y1" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x3" y="t" /></cxn><cxn ang="cd2"><pos x="x1" y="y1" /></cxn><cxn ang="cd2"><pos x="l" y="y3" /></cxn><cxn ang="cd4"><pos x="x0" y="b" /></cxn><cxn ang="0"><pos x="x4" y="y15" /></cxn><cxn ang="0"><pos x="r" y="y1" /></cxn></cxnLst><rect l="l" t="y2" r="x4" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y2" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="x1" y="y1" /></lnTo><lnTo><pt x="x3" y="t" /></lnTo><lnTo><pt x="r" y="y1" /></lnTo><lnTo><pt x="x4" y="y1" /></lnTo><lnTo><pt x="x4" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var Bm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 12500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="x1" fmla="*/ ss a 100000" /><gd name="x2" fmla="+- r 0 x1" /><gd name="y2" fmla="+- b 0 x1" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="50000"><pos x="x1" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="0"><pos x="x2" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd4"><pos x="hc" y="y2" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd2"><pos x="x1" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="3cd4"><pos x="hc" y="x1" /></cxn></cxnLst><rect l="x1" t="x1" r="x2" b="y2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="x1" y="x1" /></moveTo><lnTo><pt x="x2" y="x1" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><close /></path><path stroke="false" fill="lightenLess" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="x2" y="x1" /></lnTo><lnTo><pt x="x1" y="x1" /></lnTo><close /></path><path stroke="false" fill="darkenLess" extrusionOk="false"><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="x1" y="y2" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><close /></path><path stroke="false" fill="lighten" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="x1" y="x1" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path stroke="false" fill="darken" extrusionOk="false"><moveTo><pt x="r" y="t" /></moveTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x2" y="x1" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /><moveTo><pt x="x1" y="x1" /></moveTo><lnTo><pt x="x2" y="x1" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><close /><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="x1" y="x1" /></lnTo><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="x1" y="y2" /></lnTo><moveTo><pt x="r" y="t" /></moveTo><lnTo><pt x="x2" y="x1" /></lnTo><moveTo><pt x="r" y="b" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo></path></pathLst>';
var km = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 10800000" /><gd name="adj2" fmla="val 0" /><gd name="adj3" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="stAng" fmla="pin 0 adj1 21599999" /><gd name="istAng" fmla="pin 0 adj2 21599999" /><gd name="a3" fmla="pin 0 adj3 50000" /><gd name="sw11" fmla="+- istAng 0 stAng" /><gd name="sw12" fmla="+- sw11 21600000 0" /><gd name="swAng" fmla="?: sw11 sw11 sw12" /><gd name="iswAng" fmla="+- 0 0 swAng" /><gd name="wt1" fmla="sin wd2 stAng" /><gd name="ht1" fmla="cos hd2 stAng" /><gd name="wt3" fmla="sin wd2 istAng" /><gd name="ht3" fmla="cos hd2 istAng" /><gd name="dx1" fmla="cat2 wd2 ht1 wt1" /><gd name="dy1" fmla="sat2 hd2 ht1 wt1" /><gd name="dx3" fmla="cat2 wd2 ht3 wt3" /><gd name="dy3" fmla="sat2 hd2 ht3 wt3" /><gd name="x1" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc dy1 0" /><gd name="x3" fmla="+- hc dx3 0" /><gd name="y3" fmla="+- vc dy3 0" /><gd name="dr" fmla="*/ ss a3 100000" /><gd name="iwd2" fmla="+- wd2 0 dr" /><gd name="ihd2" fmla="+- hd2 0 dr" /><gd name="wt2" fmla="sin iwd2 istAng" /><gd name="ht2" fmla="cos ihd2 istAng" /><gd name="wt4" fmla="sin iwd2 stAng" /><gd name="ht4" fmla="cos ihd2 stAng" /><gd name="dx2" fmla="cat2 iwd2 ht2 wt2" /><gd name="dy2" fmla="sat2 ihd2 ht2 wt2" /><gd name="dx4" fmla="cat2 iwd2 ht4 wt4" /><gd name="dy4" fmla="sat2 ihd2 ht4 wt4" /><gd name="x2" fmla="+- hc dx2 0" /><gd name="y2" fmla="+- vc dy2 0" /><gd name="x4" fmla="+- hc dx4 0" /><gd name="y4" fmla="+- vc dy4 0" /><gd name="sw0" fmla="+- 21600000 0 stAng" /><gd name="da1" fmla="+- swAng 0 sw0" /><gd name="g1" fmla="max x1 x2" /><gd name="g2" fmla="max x3 x4" /><gd name="g3" fmla="max g1 g2" /><gd name="ir" fmla="?: da1 r g3" /><gd name="sw1" fmla="+- cd4 0 stAng" /><gd name="sw2" fmla="+- 27000000 0 stAng" /><gd name="sw3" fmla="?: sw1 sw1 sw2" /><gd name="da2" fmla="+- swAng 0 sw3" /><gd name="g5" fmla="max y1 y2" /><gd name="g6" fmla="max y3 y4" /><gd name="g7" fmla="max g5 g6" /><gd name="ib" fmla="?: da2 b g7" /><gd name="sw4" fmla="+- cd2 0 stAng" /><gd name="sw5" fmla="+- 32400000 0 stAng" /><gd name="sw6" fmla="?: sw4 sw4 sw5" /><gd name="da3" fmla="+- swAng 0 sw6" /><gd name="g9" fmla="min x1 x2" /><gd name="g10" fmla="min x3 x4" /><gd name="g11" fmla="min g9 g10" /><gd name="il" fmla="?: da3 l g11" /><gd name="sw7" fmla="+- 3cd4 0 stAng" /><gd name="sw8" fmla="+- 37800000 0 stAng" /><gd name="sw9" fmla="?: sw7 sw7 sw8" /><gd name="da4" fmla="+- swAng 0 sw9" /><gd name="g13" fmla="min y1 y2" /><gd name="g14" fmla="min y3 y4" /><gd name="g15" fmla="min g13 g14" /><gd name="it" fmla="?: da4 t g15" /><gd name="x5" fmla="+/ x1 x4 2" /><gd name="y5" fmla="+/ y1 y4 2" /><gd name="x6" fmla="+/ x3 x2 2" /><gd name="y6" fmla="+/ y3 y2 2" /><gd name="cang1" fmla="+- stAng 0 cd4" /><gd name="cang2" fmla="+- istAng cd4 0" /><gd name="cang3" fmla="+/ cang1 cang2 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefAng="adj1" minAng="0" maxAng="21599999"><pos x="x1" y="y1" /></ahPolar><ahPolar gdRefR="adj3" minR="0" maxR="50000" gdRefAng="adj2" minAng="0" maxAng="21599999"><pos x="x2" y="y2" /></ahPolar></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cang1"><pos x="x5" y="y5" /></cxn><cxn ang="cang2"><pos x="x6" y="y6" /></cxn><cxn ang="cang3"><pos x="hc" y="vc" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y1" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="stAng" swAng="swAng" /><lnTo><pt x="x2" y="y2" /></lnTo><arcTo wR="iwd2" hR="ihd2" stAng="istAng" swAng="iswAng" /><close /></path></pathLst>';
var qm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 18750" /><gd name="adj2" fmla="val -8333" /><gd name="adj3" fmla="val 112500" /><gd name="adj4" fmla="val -38333" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y1" fmla="*/ h adj1 100000" /><gd name="x1" fmla="*/ w adj2 100000" /><gd name="y2" fmla="*/ h adj3 100000" /><gd name="x2" fmla="*/ w adj4 100000" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj2" minX="-2147483647" maxX="2147483647" gdRefY="adj1" minY="-2147483647" maxY="2147483647"><pos x="x1" y="y1" /></ahXY><ahXY gdRefX="adj4" minX="-2147483647" maxX="2147483647" gdRefY="adj3" minY="-2147483647" maxY="2147483647"><pos x="x2" y="y2" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo></path></pathLst>';
var Mm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 18750" /><gd name="adj2" fmla="val -8333" /><gd name="adj3" fmla="val 18750" /><gd name="adj4" fmla="val -16667" /><gd name="adj5" fmla="val 112500" /><gd name="adj6" fmla="val -46667" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y1" fmla="*/ h adj1 100000" /><gd name="x1" fmla="*/ w adj2 100000" /><gd name="y2" fmla="*/ h adj3 100000" /><gd name="x2" fmla="*/ w adj4 100000" /><gd name="y3" fmla="*/ h adj5 100000" /><gd name="x3" fmla="*/ w adj6 100000" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj2" minX="-2147483647" maxX="2147483647" gdRefY="adj1" minY="-2147483647" maxY="2147483647"><pos x="x1" y="y1" /></ahXY><ahXY gdRefX="adj4" minX="-2147483647" maxX="2147483647" gdRefY="adj3" minY="-2147483647" maxY="2147483647"><pos x="x2" y="y2" /></ahXY><ahXY gdRefX="adj6" minX="-2147483647" maxX="2147483647" gdRefY="adj5" minY="-2147483647" maxY="2147483647"><pos x="x3" y="y3" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo></path></pathLst>';
var Pm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 18750" /><gd name="adj2" fmla="val -8333" /><gd name="adj3" fmla="val 18750" /><gd name="adj4" fmla="val -16667" /><gd name="adj5" fmla="val 100000" /><gd name="adj6" fmla="val -16667" /><gd name="adj7" fmla="val 112963" /><gd name="adj8" fmla="val -8333" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y1" fmla="*/ h adj1 100000" /><gd name="x1" fmla="*/ w adj2 100000" /><gd name="y2" fmla="*/ h adj3 100000" /><gd name="x2" fmla="*/ w adj4 100000" /><gd name="y3" fmla="*/ h adj5 100000" /><gd name="x3" fmla="*/ w adj6 100000" /><gd name="y4" fmla="*/ h adj7 100000" /><gd name="x4" fmla="*/ w adj8 100000" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj2" minX="-2147483647" maxX="2147483647" gdRefY="adj1" minY="-2147483647" maxY="2147483647"><pos x="x1" y="y1" /></ahXY><ahXY gdRefX="adj4" minX="-2147483647" maxX="2147483647" gdRefY="adj3" minY="-2147483647" maxY="2147483647"><pos x="x2" y="y2" /></ahXY><ahXY gdRefX="adj6" minX="-2147483647" maxX="2147483647" gdRefY="adj5" minY="-2147483647" maxY="2147483647"><pos x="x3" y="y3" /></ahXY><ahXY gdRefX="adj8" minX="-2147483647" maxX="2147483647" gdRefY="adj7" minY="-2147483647" maxY="2147483647"><pos x="x4" y="y4" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo><lnTo><pt x="x4" y="y4" /></lnTo></path></pathLst>';
var Sm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 8333" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 25000" /><gd name="x1" fmla="*/ ss a 100000" /><gd name="x2" fmla="*/ ss a 50000" /><gd name="x3" fmla="+- r 0 x2" /><gd name="x4" fmla="+- r 0 x1" /><gd name="y2" fmla="+- vc 0 x1" /><gd name="y3" fmla="+- vc x1 0" /><gd name="y4" fmla="+- b 0 x1" /><gd name="it" fmla="*/ x1 29289 100000" /><gd name="il" fmla="+- x1 it 0" /><gd name="ir" fmla="+- r 0 il" /><gd name="ib" fmla="+- b 0 it" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="25000"><pos x="l" y="x1" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="il" t="il" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="x2" y="b" /></moveTo><arcTo wR="x1" hR="x1" stAng="cd4" swAng="cd4" /><lnTo><pt x="x1" y="y3" /></lnTo><arcTo wR="x1" hR="x1" stAng="0" swAng="-5400000" /><arcTo wR="x1" hR="x1" stAng="cd4" swAng="-5400000" /><lnTo><pt x="x1" y="x1" /></lnTo><arcTo wR="x1" hR="x1" stAng="cd2" swAng="cd4" /><lnTo><pt x="x3" y="t" /></lnTo><arcTo wR="x1" hR="x1" stAng="3cd4" swAng="cd4" /><lnTo><pt x="x4" y="y2" /></lnTo><arcTo wR="x1" hR="x1" stAng="cd2" swAng="-5400000" /><arcTo wR="x1" hR="x1" stAng="3cd4" swAng="-5400000" /><lnTo><pt x="x4" y="y4" /></lnTo><arcTo wR="x1" hR="x1" stAng="0" swAng="cd4" /><close /></path><path fill="none"><moveTo><pt x="x2" y="b" /></moveTo><arcTo wR="x1" hR="x1" stAng="cd4" swAng="cd4" /><lnTo><pt x="x1" y="y3" /></lnTo><arcTo wR="x1" hR="x1" stAng="0" swAng="-5400000" /><arcTo wR="x1" hR="x1" stAng="cd4" swAng="-5400000" /><lnTo><pt x="x1" y="x1" /></lnTo><arcTo wR="x1" hR="x1" stAng="cd2" swAng="cd4" /><moveTo><pt x="x3" y="t" /></moveTo><arcTo wR="x1" hR="x1" stAng="3cd4" swAng="cd4" /><lnTo><pt x="x4" y="y2" /></lnTo><arcTo wR="x1" hR="x1" stAng="cd2" swAng="-5400000" /><arcTo wR="x1" hR="x1" stAng="3cd4" swAng="-5400000" /><lnTo><pt x="x4" y="y4" /></lnTo><arcTo wR="x1" hR="x1" stAng="0" swAng="cd4" /></path></pathLst>';
var Om = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 16667" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="x1" fmla="*/ ss a 100000" /><gd name="x2" fmla="+- r 0 x1" /><gd name="y2" fmla="+- b 0 x1" /><gd name="il" fmla="*/ x1 29289 100000" /><gd name="ir" fmla="+- r 0 il" /><gd name="ib" fmla="+- b 0 il" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="50000"><pos x="l" y="x1" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="il" t="il" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="x1" /></moveTo><arcTo wR="x1" hR="x1" stAng="cd2" swAng="cd4" /><lnTo><pt x="x2" y="t" /></lnTo><arcTo wR="x1" hR="x1" stAng="3cd4" swAng="cd4" /><lnTo><pt x="r" y="y2" /></lnTo><arcTo wR="x1" hR="x1" stAng="0" swAng="cd4" /><lnTo><pt x="x1" y="b" /></lnTo><arcTo wR="x1" hR="x1" stAng="cd4" swAng="cd4" /><close /></path><path fill="none"><moveTo><pt x="x1" y="b" /></moveTo><arcTo wR="x1" hR="x1" stAng="cd4" swAng="cd4" /><lnTo><pt x="l" y="x1" /></lnTo><arcTo wR="x1" hR="x1" stAng="cd2" swAng="cd4" /><moveTo><pt x="x2" y="t" /></moveTo><arcTo wR="x1" hR="x1" stAng="3cd4" swAng="cd4" /><lnTo><pt x="r" y="y2" /></lnTo><arcTo wR="x1" hR="x1" stAng="0" swAng="cd4" /></path></pathLst>';
var Im = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 18750" /><gd name="adj2" fmla="val -8333" /><gd name="adj3" fmla="val 112500" /><gd name="adj4" fmla="val -38333" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y1" fmla="*/ h adj1 100000" /><gd name="x1" fmla="*/ w adj2 100000" /><gd name="y2" fmla="*/ h adj3 100000" /><gd name="x2" fmla="*/ w adj4 100000" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj2" minX="-2147483647" maxX="2147483647" gdRefY="adj1" minY="-2147483647" maxY="2147483647"><pos x="x1" y="y1" /></ahXY><ahXY gdRefX="adj4" minX="-2147483647" maxX="2147483647" gdRefY="adj3" minY="-2147483647" maxY="2147483647"><pos x="x2" y="y2" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo></path></pathLst>';
var Dm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 18750" /><gd name="adj2" fmla="val -8333" /><gd name="adj3" fmla="val 18750" /><gd name="adj4" fmla="val -16667" /><gd name="adj5" fmla="val 112500" /><gd name="adj6" fmla="val -46667" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y1" fmla="*/ h adj1 100000" /><gd name="x1" fmla="*/ w adj2 100000" /><gd name="y2" fmla="*/ h adj3 100000" /><gd name="x2" fmla="*/ w adj4 100000" /><gd name="y3" fmla="*/ h adj5 100000" /><gd name="x3" fmla="*/ w adj6 100000" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj2" minX="-2147483647" maxX="2147483647" gdRefY="adj1" minY="-2147483647" maxY="2147483647"><pos x="x1" y="y1" /></ahXY><ahXY gdRefX="adj4" minX="-2147483647" maxX="2147483647" gdRefY="adj3" minY="-2147483647" maxY="2147483647"><pos x="x2" y="y2" /></ahXY><ahXY gdRefX="adj6" minX="-2147483647" maxX="2147483647" gdRefY="adj5" minY="-2147483647" maxY="2147483647"><pos x="x3" y="y3" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo></path></pathLst>';
var Em = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 18750" /><gd name="adj2" fmla="val -8333" /><gd name="adj3" fmla="val 18750" /><gd name="adj4" fmla="val -16667" /><gd name="adj5" fmla="val 100000" /><gd name="adj6" fmla="val -16667" /><gd name="adj7" fmla="val 112963" /><gd name="adj8" fmla="val -8333" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y1" fmla="*/ h adj1 100000" /><gd name="x1" fmla="*/ w adj2 100000" /><gd name="y2" fmla="*/ h adj3 100000" /><gd name="x2" fmla="*/ w adj4 100000" /><gd name="y3" fmla="*/ h adj5 100000" /><gd name="x3" fmla="*/ w adj6 100000" /><gd name="y4" fmla="*/ h adj7 100000" /><gd name="x4" fmla="*/ w adj8 100000" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj2" minX="-2147483647" maxX="2147483647" gdRefY="adj1" minY="-2147483647" maxY="2147483647"><pos x="x1" y="y1" /></ahXY><ahXY gdRefX="adj4" minX="-2147483647" maxX="2147483647" gdRefY="adj3" minY="-2147483647" maxY="2147483647"><pos x="x2" y="y2" /></ahXY><ahXY gdRefX="adj6" minX="-2147483647" maxX="2147483647" gdRefY="adj5" minY="-2147483647" maxY="2147483647"><pos x="x3" y="y3" /></ahXY><ahXY gdRefX="adj8" minX="-2147483647" maxX="2147483647" gdRefY="adj7" minY="-2147483647" maxY="2147483647"><pos x="x4" y="y4" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo><lnTo><pt x="x4" y="y4" /></lnTo></path></pathLst>';
var zm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj" fmla="*/ 50000 h ss" /><gd name="a" fmla="pin 0 adj maxAdj" /><gd name="y1" fmla="*/ ss a 200000" /><gd name="y2" fmla="+- y1 y1 0" /><gd name="y3" fmla="+- b 0 y1" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="maxAdj"><pos x="hc" y="y2" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="y2" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="y2" r="r" b="y3" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="y1" /></moveTo><arcTo wR="wd2" hR="y1" stAng="cd2" swAng="-10800000" /><lnTo><pt x="r" y="y3" /></lnTo><arcTo wR="wd2" hR="y1" stAng="0" swAng="cd2" /><close /></path><path stroke="false" fill="lighten" extrusionOk="false"><moveTo><pt x="l" y="y1" /></moveTo><arcTo wR="wd2" hR="y1" stAng="cd2" swAng="cd2" /><arcTo wR="wd2" hR="y1" stAng="0" swAng="cd2" /><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="r" y="y1" /></moveTo><arcTo wR="wd2" hR="y1" stAng="0" swAng="cd2" /><arcTo wR="wd2" hR="y1" stAng="cd2" swAng="cd2" /><lnTo><pt x="r" y="y3" /></lnTo><arcTo wR="wd2" hR="y1" stAng="0" swAng="cd2" /><lnTo><pt x="l" y="y1" /></lnTo></path></pathLst>';
var Gm = '<pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="10" h="10" fill="none" extrusionOk="false"><moveTo><pt x="5" y="0" /></moveTo><lnTo><pt x="5" y="10" /></lnTo><moveTo><pt x="0" y="5" /></moveTo><lnTo><pt x="10" y="5" /></lnTo></path><path w="10" h="10" stroke="false"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="0" y="10" /></lnTo><lnTo><pt x="10" y="10" /></lnTo><lnTo><pt x="10" y="0" /></lnTo><close /></path></pathLst>';
var Hm = '<pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="10" h="10" fill="none" extrusionOk="false"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="10" y="10" /></lnTo><moveTo><pt x="0" y="10" /></moveTo><lnTo><pt x="10" y="0" /></lnTo><moveTo><pt x="5" y="0" /></moveTo><lnTo><pt x="5" y="10" /></lnTo></path><path w="10" h="10" stroke="false"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="0" y="10" /></lnTo><lnTo><pt x="10" y="10" /></lnTo><lnTo><pt x="10" y="0" /></lnTo><close /></path></pathLst>';
var Nm = '<pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="10" h="10" fill="none" extrusionOk="false"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="10" y="10" /></lnTo><moveTo><pt x="0" y="10" /></moveTo><lnTo><pt x="10" y="0" /></lnTo></path><path w="10" h="10" stroke="false"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="0" y="10" /></lnTo><lnTo><pt x="10" y="10" /></lnTo><lnTo><pt x="10" y="0" /></lnTo><close /></path></pathLst>';
var Zm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj" fmla="*/ 100000 w ss" /><gd name="a" fmla="pin 0 adj maxAdj" /><gd name="x1" fmla="*/ ss a 100000" /><gd name="x2" fmla="+- r 0 x1" /><gd name="x3" fmla="*/ x2 1 2" /><gd name="dx" fmla="+- x2 0 x1" /><gd name="il" fmla="?: dx x1 l" /><gd name="ir" fmla="?: dx x2 r" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="maxAdj"><pos x="x2" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x3" y="t" /></cxn><cxn ang="cd2"><pos x="x1" y="vc" /></cxn><cxn ang="cd4"><pos x="x3" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="il" t="t" r="ir" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="x2" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><lnTo><pt x="x1" y="vc" /></lnTo><close /></path></pathLst>';
var _m = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 2700000" /><gd name="adj2" fmla="val 16200000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="stAng" fmla="pin 0 adj1 21599999" /><gd name="enAng" fmla="pin 0 adj2 21599999" /><gd name="sw1" fmla="+- enAng 0 stAng" /><gd name="sw2" fmla="+- sw1 21600000 0" /><gd name="swAng" fmla="?: sw1 sw1 sw2" /><gd name="wt1" fmla="sin wd2 stAng" /><gd name="ht1" fmla="cos hd2 stAng" /><gd name="dx1" fmla="cat2 wd2 ht1 wt1" /><gd name="dy1" fmla="sat2 hd2 ht1 wt1" /><gd name="wt2" fmla="sin wd2 enAng" /><gd name="ht2" fmla="cos hd2 enAng" /><gd name="dx2" fmla="cat2 wd2 ht2 wt2" /><gd name="dy2" fmla="sat2 hd2 ht2 wt2" /><gd name="x1" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc dy1 0" /><gd name="x2" fmla="+- hc dx2 0" /><gd name="y2" fmla="+- vc dy2 0" /><gd name="x3" fmla="+/ x1 x2 2" /><gd name="y3" fmla="+/ y1 y2 2" /><gd name="midAng0" fmla="*/ swAng 1 2" /><gd name="midAng" fmla="+- stAng midAng0 cd2" /><gd name="idx" fmla="cos wd2 2700000" /><gd name="idy" fmla="sin hd2 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="ir" fmla="+- hc idx 0" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ib" fmla="+- vc idy 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefAng="adj1" minAng="0" maxAng="21599999"><pos x="x1" y="y1" /></ahPolar><ahPolar gdRefAng="adj2" minAng="0" maxAng="21599999"><pos x="x2" y="y2" /></ahPolar></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="stAng"><pos x="x1" y="y1" /></cxn><cxn ang="enAng"><pos x="x2" y="y2" /></cxn><cxn ang="midAng"><pos x="x3" y="y3" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y1" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="stAng" swAng="swAng" /><close /></path></pathLst>';
var Vm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 12500" /><gd name="adj2" fmla="val 1142319" /><gd name="adj3" fmla="val 20457681" /><gd name="adj4" fmla="val 10800000" /><gd name="adj5" fmla="val 12500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a5" fmla="pin 0 adj5 25000" /><gd name="maxAdj1" fmla="*/ a5 2 1" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="enAng" fmla="pin 1 adj3 21599999" /><gd name="stAng" fmla="pin 0 adj4 21599999" /><gd name="th" fmla="*/ ss a1 100000" /><gd name="thh" fmla="*/ ss a5 100000" /><gd name="th2" fmla="*/ th 1 2" /><gd name="rw1" fmla="+- wd2 th2 thh" /><gd name="rh1" fmla="+- hd2 th2 thh" /><gd name="rw2" fmla="+- rw1 0 th" /><gd name="rh2" fmla="+- rh1 0 th" /><gd name="rw3" fmla="+- rw2 th2 0" /><gd name="rh3" fmla="+- rh2 th2 0" /><gd name="wtH" fmla="sin rw3 enAng" /><gd name="htH" fmla="cos rh3 enAng" /><gd name="dxH" fmla="cat2 rw3 htH wtH" /><gd name="dyH" fmla="sat2 rh3 htH wtH" /><gd name="xH" fmla="+- hc dxH 0" /><gd name="yH" fmla="+- vc dyH 0" /><gd name="rI" fmla="min rw2 rh2" /><gd name="u1" fmla="*/ dxH dxH 1" /><gd name="u2" fmla="*/ dyH dyH 1" /><gd name="u3" fmla="*/ rI rI 1" /><gd name="u4" fmla="+- u1 0 u3" /><gd name="u5" fmla="+- u2 0 u3" /><gd name="u6" fmla="*/ u4 u5 u1" /><gd name="u7" fmla="*/ u6 1 u2" /><gd name="u8" fmla="+- 1 0 u7" /><gd name="u9" fmla="sqrt u8" /><gd name="u10" fmla="*/ u4 1 dxH" /><gd name="u11" fmla="*/ u10 1 dyH" /><gd name="u12" fmla="+/ 1 u9 u11" /><gd name="u13" fmla="at2 1 u12" /><gd name="u14" fmla="+- u13 21600000 0" /><gd name="u15" fmla="?: u13 u13 u14" /><gd name="u16" fmla="+- u15 0 enAng" /><gd name="u17" fmla="+- u16 21600000 0" /><gd name="u18" fmla="?: u16 u16 u17" /><gd name="u19" fmla="+- u18 0 cd2" /><gd name="u20" fmla="+- u18 0 21600000" /><gd name="u21" fmla="?: u19 u20 u18" /><gd name="maxAng" fmla="abs u21" /><gd name="aAng" fmla="pin 0 adj2 maxAng" /><gd name="ptAng" fmla="+- enAng aAng 0" /><gd name="wtA" fmla="sin rw3 ptAng" /><gd name="htA" fmla="cos rh3 ptAng" /><gd name="dxA" fmla="cat2 rw3 htA wtA" /><gd name="dyA" fmla="sat2 rh3 htA wtA" /><gd name="xA" fmla="+- hc dxA 0" /><gd name="yA" fmla="+- vc dyA 0" /><gd name="wtE" fmla="sin rw1 stAng" /><gd name="htE" fmla="cos rh1 stAng" /><gd name="dxE" fmla="cat2 rw1 htE wtE" /><gd name="dyE" fmla="sat2 rh1 htE wtE" /><gd name="xE" fmla="+- hc dxE 0" /><gd name="yE" fmla="+- vc dyE 0" /><gd name="dxG" fmla="cos thh ptAng" /><gd name="dyG" fmla="sin thh ptAng" /><gd name="xG" fmla="+- xH dxG 0" /><gd name="yG" fmla="+- yH dyG 0" /><gd name="dxB" fmla="cos thh ptAng" /><gd name="dyB" fmla="sin thh ptAng" /><gd name="xB" fmla="+- xH 0 dxB 0" /><gd name="yB" fmla="+- yH 0 dyB 0" /><gd name="sx1" fmla="+- xB 0 hc" /><gd name="sy1" fmla="+- yB 0 vc" /><gd name="sx2" fmla="+- xG 0 hc" /><gd name="sy2" fmla="+- yG 0 vc" /><gd name="rO" fmla="min rw1 rh1" /><gd name="x1O" fmla="*/ sx1 rO rw1" /><gd name="y1O" fmla="*/ sy1 rO rh1" /><gd name="x2O" fmla="*/ sx2 rO rw1" /><gd name="y2O" fmla="*/ sy2 rO rh1" /><gd name="dxO" fmla="+- x2O 0 x1O" /><gd name="dyO" fmla="+- y2O 0 y1O" /><gd name="dO" fmla="mod dxO dyO 0" /><gd name="q1" fmla="*/ x1O y2O 1" /><gd name="q2" fmla="*/ x2O y1O 1" /><gd name="DO" fmla="+- q1 0 q2" /><gd name="q3" fmla="*/ rO rO 1" /><gd name="q4" fmla="*/ dO dO 1" /><gd name="q5" fmla="*/ q3 q4 1" /><gd name="q6" fmla="*/ DO DO 1" /><gd name="q7" fmla="+- q5 0 q6" /><gd name="q8" fmla="max q7 0" /><gd name="sdelO" fmla="sqrt q8" /><gd name="ndyO" fmla="*/ dyO -1 1" /><gd name="sdyO" fmla="?: ndyO -1 1" /><gd name="q9" fmla="*/ sdyO dxO 1" /><gd name="q10" fmla="*/ q9 sdelO 1" /><gd name="q11" fmla="*/ DO dyO 1" /><gd name="dxF1" fmla="+/ q11 q10 q4" /><gd name="q12" fmla="+- q11 0 q10" /><gd name="dxF2" fmla="*/ q12 1 q4" /><gd name="adyO" fmla="abs dyO" /><gd name="q13" fmla="*/ adyO sdelO 1" /><gd name="q14" fmla="*/ DO dxO -1" /><gd name="dyF1" fmla="+/ q14 q13 q4" /><gd name="q15" fmla="+- q14 0 q13" /><gd name="dyF2" fmla="*/ q15 1 q4" /><gd name="q16" fmla="+- x2O 0 dxF1" /><gd name="q17" fmla="+- x2O 0 dxF2" /><gd name="q18" fmla="+- y2O 0 dyF1" /><gd name="q19" fmla="+- y2O 0 dyF2" /><gd name="q20" fmla="mod q16 q18 0" /><gd name="q21" fmla="mod q17 q19 0" /><gd name="q22" fmla="+- q21 0 q20" /><gd name="dxF" fmla="?: q22 dxF1 dxF2" /><gd name="dyF" fmla="?: q22 dyF1 dyF2" /><gd name="sdxF" fmla="*/ dxF rw1 rO" /><gd name="sdyF" fmla="*/ dyF rh1 rO" /><gd name="xF" fmla="+- hc sdxF 0" /><gd name="yF" fmla="+- vc sdyF 0" /><gd name="x1I" fmla="*/ sx1 rI rw2" /><gd name="y1I" fmla="*/ sy1 rI rh2" /><gd name="x2I" fmla="*/ sx2 rI rw2" /><gd name="y2I" fmla="*/ sy2 rI rh2" /><gd name="dxI" fmla="+- x2I 0 x1I" /><gd name="dyI" fmla="+- y2I 0 y1I" /><gd name="dI" fmla="mod dxI dyI 0" /><gd name="v1" fmla="*/ x1I y2I 1" /><gd name="v2" fmla="*/ x2I y1I 1" /><gd name="DI" fmla="+- v1 0 v2" /><gd name="v3" fmla="*/ rI rI 1" /><gd name="v4" fmla="*/ dI dI 1" /><gd name="v5" fmla="*/ v3 v4 1" /><gd name="v6" fmla="*/ DI DI 1" /><gd name="v7" fmla="+- v5 0 v6" /><gd name="v8" fmla="max v7 0" /><gd name="sdelI" fmla="sqrt v8" /><gd name="v9" fmla="*/ sdyO dxI 1" /><gd name="v10" fmla="*/ v9 sdelI 1" /><gd name="v11" fmla="*/ DI dyI 1" /><gd name="dxC1" fmla="+/ v11 v10 v4" /><gd name="v12" fmla="+- v11 0 v10" /><gd name="dxC2" fmla="*/ v12 1 v4" /><gd name="adyI" fmla="abs dyI" /><gd name="v13" fmla="*/ adyI sdelI 1" /><gd name="v14" fmla="*/ DI dxI -1" /><gd name="dyC1" fmla="+/ v14 v13 v4" /><gd name="v15" fmla="+- v14 0 v13" /><gd name="dyC2" fmla="*/ v15 1 v4" /><gd name="v16" fmla="+- x1I 0 dxC1" /><gd name="v17" fmla="+- x1I 0 dxC2" /><gd name="v18" fmla="+- y1I 0 dyC1" /><gd name="v19" fmla="+- y1I 0 dyC2" /><gd name="v20" fmla="mod v16 v18 0" /><gd name="v21" fmla="mod v17 v19 0" /><gd name="v22" fmla="+- v21 0 v20" /><gd name="dxC" fmla="?: v22 dxC1 dxC2" /><gd name="dyC" fmla="?: v22 dyC1 dyC2" /><gd name="sdxC" fmla="*/ dxC rw2 rI" /><gd name="sdyC" fmla="*/ dyC rh2 rI" /><gd name="xC" fmla="+- hc sdxC 0" /><gd name="yC" fmla="+- vc sdyC 0" /><gd name="ist0" fmla="at2 sdxC sdyC" /><gd name="ist1" fmla="+- ist0 21600000 0" /><gd name="istAng" fmla="?: ist0 ist0 ist1" /><gd name="isw1" fmla="+- stAng 0 istAng" /><gd name="isw2" fmla="+- isw1 0 21600000" /><gd name="iswAng" fmla="?: isw1 isw2 isw1" /><gd name="p1" fmla="+- xF 0 xC" /><gd name="p2" fmla="+- yF 0 yC" /><gd name="p3" fmla="mod p1 p2 0" /><gd name="p4" fmla="*/ p3 1 2" /><gd name="p5" fmla="+- p4 0 thh" /><gd name="xGp" fmla="?: p5 xF xG" /><gd name="yGp" fmla="?: p5 yF yG" /><gd name="xBp" fmla="?: p5 xC xB" /><gd name="yBp" fmla="?: p5 yC yB" /><gd name="en0" fmla="at2 sdxF sdyF" /><gd name="en1" fmla="+- en0 21600000 0" /><gd name="en2" fmla="?: en0 en0 en1" /><gd name="sw0" fmla="+- en2 0 stAng" /><gd name="sw1" fmla="+- sw0 21600000 0" /><gd name="swAng" fmla="?: sw0 sw0 sw1" /><gd name="wtI" fmla="sin rw3 stAng" /><gd name="htI" fmla="cos rh3 stAng" /><gd name="dxI" fmla="cat2 rw3 htI wtI" /><gd name="dyI" fmla="sat2 rh3 htI wtI" /><gd name="xI" fmla="+- hc dxI 0" /><gd name="yI" fmla="+- vc dyI 0" /><gd name="aI" fmla="+- stAng 0 cd4" /><gd name="aA" fmla="+- ptAng cd4 0" /><gd name="aB" fmla="+- ptAng cd2 0" /><gd name="idx" fmla="cos rw1 2700000" /><gd name="idy" fmla="sin rh1 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="ir" fmla="+- hc idx 0" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ib" fmla="+- vc idy 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefAng="adj2" minAng="0" maxAng="maxAng"><pos x="xA" y="yA" /></ahPolar><ahPolar gdRefAng="adj4" minAng="0" maxAng="21599999"><pos x="xE" y="yE" /></ahPolar><ahPolar gdRefR="adj1" minR="0" maxR="maxAdj1" gdRefAng="adj3" minAng="0" maxAng="21599999"><pos x="xF" y="yF" /></ahPolar><ahPolar gdRefR="adj5" minR="0" maxR="25000"><pos x="xB" y="yB" /></ahPolar></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="aI"><pos x="xI" y="yI" /></cxn><cxn ang="ptAng"><pos x="xGp" y="yGp" /></cxn><cxn ang="aA"><pos x="xA" y="yA" /></cxn><cxn ang="aB"><pos x="xBp" y="yBp" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="xE" y="yE" /></moveTo><arcTo wR="rw1" hR="rh1" stAng="stAng" swAng="swAng" /><lnTo><pt x="xGp" y="yGp" /></lnTo><lnTo><pt x="xA" y="yA" /></lnTo><lnTo><pt x="xBp" y="yBp" /></lnTo><lnTo><pt x="xC" y="yC" /></lnTo><arcTo wR="rw2" hR="rh2" stAng="istAng" swAng="iswAng" /><close /></path></pathLst>';
var Wm = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="il" fmla="*/ w 2977 21600" /><gd name="it" fmla="*/ h 3262 21600" /><gd name="ir" fmla="*/ w 17087 21600" /><gd name="ib" fmla="*/ h 17337 21600" /><gd name="g27" fmla="*/ w 67 21600" /><gd name="g28" fmla="*/ h 21577 21600" /><gd name="g29" fmla="*/ w 21582 21600" /><gd name="g30" fmla="*/ h 1235 21600" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="g29" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="g28" /></cxn><cxn ang="cd2"><pos x="g27" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="g30" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="43200" h="43200"><moveTo><pt x="3900" y="14370" /></moveTo><arcTo wR="6753" hR="9190" stAng="-11429249" swAng="7426832" /><arcTo wR="5333" hR="7267" stAng="-8646143" swAng="5396714" /><arcTo wR="4365" hR="5945" stAng="-8748475" swAng="5983381" /><arcTo wR="4857" hR="6595" stAng="-7859164" swAng="7034504" /><arcTo wR="5333" hR="7273" stAng="-4722533" swAng="6541615" /><arcTo wR="6775" hR="9220" stAng="-2776035" swAng="7816140" /><arcTo wR="5785" hR="7867" stAng="37501" swAng="6842000" /><arcTo wR="6752" hR="9215" stAng="1347096" swAng="6910353" /><arcTo wR="7720" hR="10543" stAng="3974558" swAng="4542661" /><arcTo wR="4360" hR="5918" stAng="-16496525" swAng="8804134" /><arcTo wR="4345" hR="5945" stAng="-14809710" swAng="9151131" /><close /></path><path w="43200" h="43200" fill="none" extrusionOk="false"><moveTo><pt x="4693" y="26177" /></moveTo><arcTo wR="4345" hR="5945" stAng="5204520" swAng="1585770" /><moveTo><pt x="6928" y="34899" /></moveTo><arcTo wR="4360" hR="5918" stAng="4416628" swAng="686848" /><moveTo><pt x="16478" y="39090" /></moveTo><arcTo wR="6752" hR="9215" stAng="8257449" swAng="844866" /><moveTo><pt x="28827" y="34751" /></moveTo><arcTo wR="6752" hR="9215" stAng="387196" swAng="959901" /><moveTo><pt x="34129" y="22954" /></moveTo><arcTo wR="5785" hR="7867" stAng="-4217541" swAng="4255042" /><moveTo><pt x="41798" y="15354" /></moveTo><arcTo wR="5333" hR="7273" stAng="1819082" swAng="1665090" /><moveTo><pt x="38324" y="5426" /></moveTo><arcTo wR="4857" hR="6595" stAng="-824660" swAng="891534" /><moveTo><pt x="29078" y="3952" /></moveTo><arcTo wR="4857" hR="6595" stAng="-8950887" swAng="1091722" /><moveTo><pt x="22141" y="4720" /></moveTo><arcTo wR="4365" hR="5945" stAng="-9809656" swAng="1061181" /><moveTo><pt x="14000" y="5192" /></moveTo><arcTo wR="6753" hR="9190" stAng="-4002417" swAng="739161" /><moveTo><pt x="4127" y="15789" /></moveTo><arcTo wR="6753" hR="9190" stAng="9459261" swAng="711490" /></path></pathLst>';
var Qm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val -20833" /><gd name="adj2" fmla="val 62500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="dxPos" fmla="*/ w adj1 100000" /><gd name="dyPos" fmla="*/ h adj2 100000" /><gd name="xPos" fmla="+- hc dxPos 0" /><gd name="yPos" fmla="+- vc dyPos 0" /><gd name="ht" fmla="cat2 hd2 dxPos dyPos" /><gd name="wt" fmla="sat2 wd2 dxPos dyPos" /><gd name="g2" fmla="cat2 wd2 ht wt" /><gd name="g3" fmla="sat2 hd2 ht wt" /><gd name="g4" fmla="+- hc g2 0" /><gd name="g5" fmla="+- vc g3 0" /><gd name="g6" fmla="+- g4 0 xPos" /><gd name="g7" fmla="+- g5 0 yPos" /><gd name="g8" fmla="mod g6 g7 0" /><gd name="g9" fmla="*/ ss 6600 21600" /><gd name="g10" fmla="+- g8 0 g9" /><gd name="g11" fmla="*/ g10 1 3" /><gd name="g12" fmla="*/ ss 1800 21600" /><gd name="g13" fmla="+- g11 g12 0" /><gd name="g14" fmla="*/ g13 g6 g8" /><gd name="g15" fmla="*/ g13 g7 g8" /><gd name="g16" fmla="+- g14 xPos 0" /><gd name="g17" fmla="+- g15 yPos 0" /><gd name="g18" fmla="*/ ss 4800 21600" /><gd name="g19" fmla="*/ g11 2 1" /><gd name="g20" fmla="+- g18 g19 0" /><gd name="g21" fmla="*/ g20 g6 g8" /><gd name="g22" fmla="*/ g20 g7 g8" /><gd name="g23" fmla="+- g21 xPos 0" /><gd name="g24" fmla="+- g22 yPos 0" /><gd name="g25" fmla="*/ ss 1200 21600" /><gd name="g26" fmla="*/ ss 600 21600" /><gd name="x23" fmla="+- xPos g26 0" /><gd name="x24" fmla="+- g16 g25 0" /><gd name="x25" fmla="+- g23 g12 0" /><gd name="il" fmla="*/ w 2977 21600" /><gd name="it" fmla="*/ h 3262 21600" /><gd name="ir" fmla="*/ w 17087 21600" /><gd name="ib" fmla="*/ h 17337 21600" /><gd name="g27" fmla="*/ w 67 21600" /><gd name="g28" fmla="*/ h 21577 21600" /><gd name="g29" fmla="*/ w 21582 21600" /><gd name="g30" fmla="*/ h 1235 21600" /><gd name="pang" fmla="at2 dxPos dyPos" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="-2147483647" maxX="2147483647" gdRefY="adj2" minY="-2147483647" maxY="2147483647"><pos x="xPos" y="yPos" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd2"><pos x="g27" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="g28" /></cxn><cxn ang="0"><pos x="g29" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="g30" /></cxn><cxn ang="pang"><pos x="xPos" y="yPos" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="43200" h="43200"><moveTo><pt x="3900" y="14370" /></moveTo><arcTo wR="6753" hR="9190" stAng="-11429249" swAng="7426832" /><arcTo wR="5333" hR="7267" stAng="-8646143" swAng="5396714" /><arcTo wR="4365" hR="5945" stAng="-8748475" swAng="5983381" /><arcTo wR="4857" hR="6595" stAng="-7859164" swAng="7034504" /><arcTo wR="5333" hR="7273" stAng="-4722533" swAng="6541615" /><arcTo wR="6775" hR="9220" stAng="-2776035" swAng="7816140" /><arcTo wR="5785" hR="7867" stAng="37501" swAng="6842000" /><arcTo wR="6752" hR="9215" stAng="1347096" swAng="6910353" /><arcTo wR="7720" hR="10543" stAng="3974558" swAng="4542661" /><arcTo wR="4360" hR="5918" stAng="-16496525" swAng="8804134" /><arcTo wR="4345" hR="5945" stAng="-14809710" swAng="9151131" /><close /></path><path><moveTo><pt x="x23" y="yPos" /></moveTo><arcTo wR="g26" hR="g26" stAng="0" swAng="21600000" /><close /></path><path><moveTo><pt x="x24" y="g17" /></moveTo><arcTo wR="g25" hR="g25" stAng="0" swAng="21600000" /><close /></path><path><moveTo><pt x="x25" y="g24" /></moveTo><arcTo wR="g12" hR="g12" stAng="0" swAng="21600000" /><close /></path><path w="43200" h="43200" fill="none" extrusionOk="false"><moveTo><pt x="4693" y="26177" /></moveTo><arcTo wR="4345" hR="5945" stAng="5204520" swAng="1585770" /><moveTo><pt x="6928" y="34899" /></moveTo><arcTo wR="4360" hR="5918" stAng="4416628" swAng="686848" /><moveTo><pt x="16478" y="39090" /></moveTo><arcTo wR="6752" hR="9215" stAng="8257449" swAng="844866" /><moveTo><pt x="28827" y="34751" /></moveTo><arcTo wR="6752" hR="9215" stAng="387196" swAng="959901" /><moveTo><pt x="34129" y="22954" /></moveTo><arcTo wR="5785" hR="7867" stAng="-4217541" swAng="4255042" /><moveTo><pt x="41798" y="15354" /></moveTo><arcTo wR="5333" hR="7273" stAng="1819082" swAng="1665090" /><moveTo><pt x="38324" y="5426" /></moveTo><arcTo wR="4857" hR="6595" stAng="-824660" swAng="891534" /><moveTo><pt x="29078" y="3952" /></moveTo><arcTo wR="4857" hR="6595" stAng="-8950887" swAng="1091722" /><moveTo><pt x="22141" y="4720" /></moveTo><arcTo wR="4365" hR="5945" stAng="-9809656" swAng="1061181" /><moveTo><pt x="14000" y="5192" /></moveTo><arcTo wR="6753" hR="9190" stAng="-4002417" swAng="739161" /><moveTo><pt x="4127" y="15789" /></moveTo><arcTo wR="6753" hR="9190" stAng="9459261" swAng="711490" /></path></pathLst>';
var Um = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 50000" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj1" fmla="*/ 100000 h ss" /><gd name="maxAdj2" fmla="*/ 100000 w ss" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="x1" fmla="*/ ss a2 100000" /><gd name="dy1" fmla="*/ ss a1 100000" /><gd name="y1" fmla="+- b 0 dy1" /><gd name="cx1" fmla="*/ x1 1 2" /><gd name="cy1" fmla="+/ y1 b 2" /><gd name="d" fmla="+- w 0 h" /><gd name="it" fmla="?: d y1 t" /><gd name="ir" fmla="?: d r x1" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="maxAdj1"><pos x="l" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="maxAdj2"><pos x="x1" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="cy1" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="cx1" y="t" /></cxn></cxnLst><rect l="l" t="it" r="ir" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="x1" y="t" /></lnTo><lnTo><pt x="x1" y="y1" /></lnTo><lnTo><pt x="r" y="y1" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var Km = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="md" fmla="mod w h 0" /><gd name="dx" fmla="*/ 1 md 20" /><gd name="y1" fmla="+- 0 b dx" /><gd name="x1" fmla="+- 0 r dx" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd2"><pos x="l" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="dx" /></cxn><cxn ang="cd2"><pos x="l" y="y1" /></cxn><cxn ang="cd2"><pos x="l" y="b" /></cxn><cxn ang="3cd4"><pos x="dx" y="t" /></cxn><cxn ang="3cd4"><pos x="x1" y="t" /></cxn><cxn ang="cd4"><pos x="dx" y="b" /></cxn><cxn ang="cd4"><pos x="x1" y="b" /></cxn><cxn ang="0"><pos x="r" y="t" /></cxn><cxn ang="0"><pos x="r" y="dx" /></cxn><cxn ang="0"><pos x="r" y="y1" /></cxn><cxn ang="0"><pos x="r" y="b" /></cxn></cxnLst><rect l="dx" t="dx" r="x1" b="y1" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="dx" y="t" /></lnTo><lnTo><pt x="l" y="dx" /></lnTo><close /></path><path><moveTo><pt x="l" y="y1" /></moveTo><lnTo><pt x="dx" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path><moveTo><pt x="x1" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="dx" /></lnTo><close /></path><path><moveTo><pt x="r" y="y1" /></moveTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="x1" y="b" /></lnTo><close /></path></pathLst>';
var Jm = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 100000" /><gd name="y1" fmla="*/ ss a 100000" /><gd name="y4" fmla="+- b 0 y1" /><gd name="y2" fmla="*/ y4 1 2" /><gd name="y3" fmla="+/ y1 b 2" /><gd name="x4" fmla="+- r 0 y1" /><gd name="x2" fmla="*/ x4 1 2" /><gd name="x3" fmla="+/ y1 r 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="100000"><pos x="l" y="y1" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x3" y="t" /></cxn><cxn ang="3cd4"><pos x="x2" y="y1" /></cxn><cxn ang="cd2"><pos x="l" y="y3" /></cxn><cxn ang="cd4"><pos x="x2" y="b" /></cxn><cxn ang="0"><pos x="x4" y="y3" /></cxn><cxn ang="0"><pos x="r" y="y2" /></cxn></cxnLst><rect l="l" t="y1" r="x4" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="y1" /></moveTo><lnTo><pt x="x4" y="y1" /></lnTo><lnTo><pt x="x4" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path stroke="false" fill="darkenLess" extrusionOk="false"><moveTo><pt x="x4" y="y1" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="y4" /></lnTo><lnTo><pt x="x4" y="b" /></lnTo><close /></path><path stroke="false" fill="lightenLess" extrusionOk="false"><moveTo><pt x="l" y="y1" /></moveTo><lnTo><pt x="y1" y="t" /></lnTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="x4" y="y1" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="l" y="y1" /></moveTo><lnTo><pt x="y1" y="t" /></lnTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="y4" /></lnTo><lnTo><pt x="x4" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /><moveTo><pt x="l" y="y1" /></moveTo><lnTo><pt x="x4" y="y1" /></lnTo><lnTo><pt x="r" y="t" /></lnTo><moveTo><pt x="x4" y="y1" /></moveTo><lnTo><pt x="x4" y="b" /></lnTo></path></pathLst>';
var at = '<rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><cubicBezTo><pt x="wd2" y="t" /><pt x="r" y="hd2" /><pt x="r" y="b" /></cubicBezTo></path></pathLst>';
var nt = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x2" fmla="*/ w adj1 100000" /><gd name="x1" fmla="+/ l x2 2" /><gd name="x3" fmla="+/ r x2 2" /><gd name="y3" fmla="*/ h 3 4" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="-2147483647" maxX="2147483647"><pos x="x2" y="vc" /></ahXY></ahLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><cubicBezTo><pt x="x1" y="t" /><pt x="x2" y="hd4" /><pt x="x2" y="vc" /></cubicBezTo><cubicBezTo><pt x="x2" y="y3" /><pt x="x3" y="b" /><pt x="r" y="b" /></cubicBezTo></path></pathLst>';
var mt = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 50000" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x2" fmla="*/ w adj1 100000" /><gd name="x1" fmla="+/ l x2 2" /><gd name="x3" fmla="+/ r x2 2" /><gd name="x4" fmla="+/ x2 x3 2" /><gd name="x5" fmla="+/ x3 r 2" /><gd name="y4" fmla="*/ h adj2 100000" /><gd name="y1" fmla="+/ t y4 2" /><gd name="y2" fmla="+/ t y1 2" /><gd name="y3" fmla="+/ y1 y4 2" /><gd name="y5" fmla="+/ b y4 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="-2147483647" maxX="2147483647"><pos x="x2" y="y1" /></ahXY><ahXY gdRefY="adj2" minY="-2147483647" maxY="2147483647"><pos x="x3" y="y4" /></ahXY></ahLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><cubicBezTo><pt x="x1" y="t" /><pt x="x2" y="y2" /><pt x="x2" y="y1" /></cubicBezTo><cubicBezTo><pt x="x2" y="y3" /><pt x="x4" y="y4" /><pt x="x3" y="y4" /></cubicBezTo><cubicBezTo><pt x="x5" y="y4" /><pt x="r" y="y5" /><pt x="r" y="b" /></cubicBezTo></path></pathLst>';
var tt = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 50000" /><gd name="adj2" fmla="val 50000" /><gd name="adj3" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x3" fmla="*/ w adj1 100000" /><gd name="x6" fmla="*/ w adj3 100000" /><gd name="x1" fmla="+/ x3 x6 2" /><gd name="x2" fmla="+/ l x3 2" /><gd name="x4" fmla="+/ x3 x1 2" /><gd name="x5" fmla="+/ x6 x1 2" /><gd name="x7" fmla="+/ x6 r 2" /><gd name="y4" fmla="*/ h adj2 100000" /><gd name="y1" fmla="+/ t y4 2" /><gd name="y2" fmla="+/ t y1 2" /><gd name="y3" fmla="+/ y1 y4 2" /><gd name="y5" fmla="+/ b y4 2" /><gd name="y6" fmla="+/ y5 y4 2" /><gd name="y7" fmla="+/ y5 b 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="-2147483647" maxX="2147483647"><pos x="x3" y="y1" /></ahXY><ahXY gdRefY="adj2" minY="-2147483647" maxY="2147483647"><pos x="x1" y="y4" /></ahXY><ahXY gdRefX="adj3" minX="-2147483647" maxX="2147483647"><pos x="x6" y="y5" /></ahXY></ahLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><cubicBezTo><pt x="x2" y="t" /><pt x="x3" y="y2" /><pt x="x3" y="y1" /></cubicBezTo><cubicBezTo><pt x="x3" y="y3" /><pt x="x4" y="y4" /><pt x="x1" y="y4" /></cubicBezTo><cubicBezTo><pt x="x5" y="y4" /><pt x="x6" y="y6" /><pt x="x6" y="y5" /></cubicBezTo><cubicBezTo><pt x="x6" y="y7" /><pt x="x7" y="b" /><pt x="r" y="b" /></cubicBezTo></path></pathLst>';
var ot = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 50000" /><gd name="adj3" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 50000 w ss" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="a1" fmla="pin 0 adj1 100000" /><gd name="th" fmla="*/ ss a1 100000" /><gd name="aw" fmla="*/ ss a2 100000" /><gd name="q1" fmla="+/ th aw 4" /><gd name="wR" fmla="+- wd2 0 q1" /><gd name="q7" fmla="*/ wR 2 1" /><gd name="q8" fmla="*/ q7 q7 1" /><gd name="q9" fmla="*/ th th 1" /><gd name="q10" fmla="+- q8 0 q9" /><gd name="q11" fmla="sqrt q10" /><gd name="idy" fmla="*/ q11 h q7" /><gd name="maxAdj3" fmla="*/ 100000 idy ss" /><gd name="a3" fmla="pin 0 adj3 maxAdj3" /><gd name="ah" fmla="*/ ss adj3 100000" /><gd name="x3" fmla="+- wR th 0" /><gd name="q2" fmla="*/ h h 1" /><gd name="q3" fmla="*/ ah ah 1" /><gd name="q4" fmla="+- q2 0 q3" /><gd name="q5" fmla="sqrt q4" /><gd name="dx" fmla="*/ q5 wR h" /><gd name="x5" fmla="+- wR dx 0" /><gd name="x7" fmla="+- x3 dx 0" /><gd name="q6" fmla="+- aw 0 th" /><gd name="dh" fmla="*/ q6 1 2" /><gd name="x4" fmla="+- x5 0 dh" /><gd name="x8" fmla="+- x7 dh 0" /><gd name="aw2" fmla="*/ aw 1 2" /><gd name="x6" fmla="+- r 0 aw2" /><gd name="y1" fmla="+- b 0 ah" /><gd name="swAng" fmla="at2 ah dx" /><gd name="mswAng" fmla="+- 0 0 swAng" /><gd name="iy" fmla="+- b 0 idy" /><gd name="ix" fmla="+/ wR x3 2" /><gd name="q12" fmla="*/ th 1 2" /><gd name="dang2" fmla="at2 idy q12" /><gd name="stAng" fmla="+- 3cd4 swAng 0" /><gd name="stAng2" fmla="+- 3cd4 0 dang2" /><gd name="swAng2" fmla="+- dang2 0 cd4" /><gd name="swAng3" fmla="+- cd4 dang2 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="adj2"><pos x="x7" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="maxAdj2"><pos x="x4" y="b" /></ahXY><ahXY gdRefY="adj3" minY="0" maxY="maxAdj3"><pos x="r" y="y1" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="ix" y="t" /></cxn><cxn ang="cd4"><pos x="q12" y="b" /></cxn><cxn ang="cd4"><pos x="x4" y="y1" /></cxn><cxn ang="cd4"><pos x="x6" y="b" /></cxn><cxn ang="0"><pos x="x8" y="y1" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="x6" y="b" /></moveTo><lnTo><pt x="x4" y="y1" /></lnTo><lnTo><pt x="x5" y="y1" /></lnTo><arcTo wR="wR" hR="h" stAng="stAng" swAng="mswAng" /><lnTo><pt x="x3" y="t" /></lnTo><arcTo wR="wR" hR="h" stAng="3cd4" swAng="swAng" /><lnTo><pt x="x8" y="y1" /></lnTo><close /></path><path fill="darkenLess" stroke="false" extrusionOk="false"><moveTo><pt x="ix" y="iy" /></moveTo><arcTo wR="wR" hR="h" stAng="stAng2" swAng="swAng2" /><lnTo><pt x="l" y="b" /></lnTo><arcTo wR="wR" hR="h" stAng="cd2" swAng="swAng3" /><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="ix" y="iy" /></moveTo><arcTo wR="wR" hR="h" stAng="stAng2" swAng="swAng2" /><lnTo><pt x="l" y="b" /></lnTo><arcTo wR="wR" hR="h" stAng="cd2" swAng="cd4" /><lnTo><pt x="x3" y="t" /></lnTo><arcTo wR="wR" hR="h" stAng="3cd4" swAng="swAng" /><lnTo><pt x="x8" y="y1" /></lnTo><lnTo><pt x="x6" y="b" /></lnTo><lnTo><pt x="x4" y="y1" /></lnTo><lnTo><pt x="x5" y="y1" /></lnTo><arcTo wR="wR" hR="h" stAng="stAng" swAng="mswAng" /></path></pathLst>';
var lt = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 50000" /><gd name="adj3" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 50000 h ss" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="a1" fmla="pin 0 adj1 a2" /><gd name="th" fmla="*/ ss a1 100000" /><gd name="aw" fmla="*/ ss a2 100000" /><gd name="q1" fmla="+/ th aw 4" /><gd name="hR" fmla="+- hd2 0 q1" /><gd name="q7" fmla="*/ hR 2 1" /><gd name="q8" fmla="*/ q7 q7 1" /><gd name="q9" fmla="*/ th th 1" /><gd name="q10" fmla="+- q8 0 q9" /><gd name="q11" fmla="sqrt q10" /><gd name="idx" fmla="*/ q11 w q7" /><gd name="maxAdj3" fmla="*/ 100000 idx ss" /><gd name="a3" fmla="pin 0 adj3 maxAdj3" /><gd name="ah" fmla="*/ ss a3 100000" /><gd name="y3" fmla="+- hR th 0" /><gd name="q2" fmla="*/ w w 1" /><gd name="q3" fmla="*/ ah ah 1" /><gd name="q4" fmla="+- q2 0 q3" /><gd name="q5" fmla="sqrt q4" /><gd name="dy" fmla="*/ q5 hR w" /><gd name="y5" fmla="+- hR dy 0" /><gd name="y7" fmla="+- y3 dy 0" /><gd name="q6" fmla="+- aw 0 th" /><gd name="dh" fmla="*/ q6 1 2" /><gd name="y4" fmla="+- y5 0 dh" /><gd name="y8" fmla="+- y7 dh 0" /><gd name="aw2" fmla="*/ aw 1 2" /><gd name="y6" fmla="+- b 0 aw2" /><gd name="x1" fmla="+- l ah 0" /><gd name="swAng" fmla="at2 ah dy" /><gd name="mswAng" fmla="+- 0 0 swAng" /><gd name="ix" fmla="+- l idx 0" /><gd name="iy" fmla="+/ hR y3 2" /><gd name="q12" fmla="*/ th 1 2" /><gd name="dang2" fmla="at2 idx q12" /><gd name="swAng2" fmla="+- dang2 0 swAng" /><gd name="swAng3" fmla="+- swAng dang2 0" /><gd name="stAng3" fmla="+- 0 0 dang2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="a2"><pos x="x1" y="y5" /></ahXY><ahXY gdRefY="adj2" minY="0" maxY="maxAdj2"><pos x="r" y="y4" /></ahXY><ahXY gdRefX="adj3" minX="0" maxX="maxAdj3"><pos x="x1" y="b" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd2"><pos x="l" y="q12" /></cxn><cxn ang="cd2"><pos x="x1" y="y4" /></cxn><cxn ang="cd3"><pos x="l" y="y6" /></cxn><cxn ang="cd4"><pos x="x1" y="y8" /></cxn><cxn ang="0"><pos x="r" y="iy" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="y6" /></moveTo><lnTo><pt x="x1" y="y4" /></lnTo><lnTo><pt x="x1" y="y5" /></lnTo><arcTo wR="w" hR="hR" stAng="swAng" swAng="swAng2" /><arcTo wR="w" hR="hR" stAng="stAng3" swAng="swAng3" /><lnTo><pt x="x1" y="y8" /></lnTo><close /></path><path fill="darkenLess" stroke="false" extrusionOk="false"><moveTo><pt x="r" y="y3" /></moveTo><arcTo wR="w" hR="hR" stAng="0" swAng="-5400000" /><lnTo><pt x="l" y="t" /></lnTo><arcTo wR="w" hR="hR" stAng="3cd4" swAng="cd4" /><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="r" y="y3" /></moveTo><arcTo wR="w" hR="hR" stAng="0" swAng="-5400000" /><lnTo><pt x="l" y="t" /></lnTo><arcTo wR="w" hR="hR" stAng="3cd4" swAng="cd4" /><lnTo><pt x="r" y="y3" /></lnTo><arcTo wR="w" hR="hR" stAng="0" swAng="swAng" /><lnTo><pt x="x1" y="y8" /></lnTo><lnTo><pt x="l" y="y6" /></lnTo><lnTo><pt x="x1" y="y4" /></lnTo><lnTo><pt x="x1" y="y5" /></lnTo><arcTo wR="w" hR="hR" stAng="swAng" swAng="swAng2" /></path></pathLst>';
var st = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 50000" /><gd name="adj3" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 50000 h ss" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="a1" fmla="pin 0 adj1 a2" /><gd name="th" fmla="*/ ss a1 100000" /><gd name="aw" fmla="*/ ss a2 100000" /><gd name="q1" fmla="+/ th aw 4" /><gd name="hR" fmla="+- hd2 0 q1" /><gd name="q7" fmla="*/ hR 2 1" /><gd name="q8" fmla="*/ q7 q7 1" /><gd name="q9" fmla="*/ th th 1" /><gd name="q10" fmla="+- q8 0 q9" /><gd name="q11" fmla="sqrt q10" /><gd name="idx" fmla="*/ q11 w q7" /><gd name="maxAdj3" fmla="*/ 100000 idx ss" /><gd name="a3" fmla="pin 0 adj3 maxAdj3" /><gd name="ah" fmla="*/ ss a3 100000" /><gd name="y3" fmla="+- hR th 0" /><gd name="q2" fmla="*/ w w 1" /><gd name="q3" fmla="*/ ah ah 1" /><gd name="q4" fmla="+- q2 0 q3" /><gd name="q5" fmla="sqrt q4" /><gd name="dy" fmla="*/ q5 hR w" /><gd name="y5" fmla="+- hR dy 0" /><gd name="y7" fmla="+- y3 dy 0" /><gd name="q6" fmla="+- aw 0 th" /><gd name="dh" fmla="*/ q6 1 2" /><gd name="y4" fmla="+- y5 0 dh" /><gd name="y8" fmla="+- y7 dh 0" /><gd name="aw2" fmla="*/ aw 1 2" /><gd name="y6" fmla="+- b 0 aw2" /><gd name="x1" fmla="+- r 0 ah" /><gd name="swAng" fmla="at2 ah dy" /><gd name="stAng" fmla="+- cd2 0 swAng" /><gd name="mswAng" fmla="+- 0 0 swAng" /><gd name="ix" fmla="+- r 0 idx" /><gd name="iy" fmla="+/ hR y3 2" /><gd name="q12" fmla="*/ th 1 2" /><gd name="dang2" fmla="at2 idx q12" /><gd name="swAng2" fmla="+- dang2 0 cd4" /><gd name="swAng3" fmla="+- cd4 dang2 0" /><gd name="stAng3" fmla="+- cd2 0 dang2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="a2"><pos x="x1" y="y5" /></ahXY><ahXY gdRefY="adj2" minY="0" maxY="maxAdj2"><pos x="r" y="y4" /></ahXY><ahXY gdRefX="adj3" minX="0" maxX="maxAdj3"><pos x="x1" y="b" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd2"><pos x="l" y="iy" /></cxn><cxn ang="cd4"><pos x="x1" y="y8" /></cxn><cxn ang="0"><pos x="r" y="y6" /></cxn><cxn ang="0"><pos x="x1" y="y4" /></cxn><cxn ang="0"><pos x="r" y="q12" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="hR" /></moveTo><arcTo wR="w" hR="hR" stAng="cd2" swAng="mswAng" /><lnTo><pt x="x1" y="y4" /></lnTo><lnTo><pt x="r" y="y6" /></lnTo><lnTo><pt x="x1" y="y8" /></lnTo><lnTo><pt x="x1" y="y7" /></lnTo><arcTo wR="w" hR="hR" stAng="stAng" swAng="swAng" /><close /></path><path fill="darkenLess" stroke="false" extrusionOk="false"><moveTo><pt x="r" y="th" /></moveTo><arcTo wR="w" hR="hR" stAng="3cd4" swAng="swAng2" /><arcTo wR="w" hR="hR" stAng="stAng3" swAng="swAng3" /><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="l" y="hR" /></moveTo><arcTo wR="w" hR="hR" stAng="cd2" swAng="mswAng" /><lnTo><pt x="x1" y="y4" /></lnTo><lnTo><pt x="r" y="y6" /></lnTo><lnTo><pt x="x1" y="y8" /></lnTo><lnTo><pt x="x1" y="y7" /></lnTo><arcTo wR="w" hR="hR" stAng="stAng" swAng="swAng" /><lnTo><pt x="l" y="hR" /></lnTo><arcTo wR="w" hR="hR" stAng="cd2" swAng="cd4" /><lnTo><pt x="r" y="th" /></lnTo><arcTo wR="w" hR="hR" stAng="3cd4" swAng="swAng2" /></path></pathLst>';
var et = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 50000" /><gd name="adj3" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 50000 w ss" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="a1" fmla="pin 0 adj1 100000" /><gd name="th" fmla="*/ ss a1 100000" /><gd name="aw" fmla="*/ ss a2 100000" /><gd name="q1" fmla="+/ th aw 4" /><gd name="wR" fmla="+- wd2 0 q1" /><gd name="q7" fmla="*/ wR 2 1" /><gd name="q8" fmla="*/ q7 q7 1" /><gd name="q9" fmla="*/ th th 1" /><gd name="q10" fmla="+- q8 0 q9" /><gd name="q11" fmla="sqrt q10" /><gd name="idy" fmla="*/ q11 h q7" /><gd name="maxAdj3" fmla="*/ 100000 idy ss" /><gd name="a3" fmla="pin 0 adj3 maxAdj3" /><gd name="ah" fmla="*/ ss adj3 100000" /><gd name="x3" fmla="+- wR th 0" /><gd name="q2" fmla="*/ h h 1" /><gd name="q3" fmla="*/ ah ah 1" /><gd name="q4" fmla="+- q2 0 q3" /><gd name="q5" fmla="sqrt q4" /><gd name="dx" fmla="*/ q5 wR h" /><gd name="x5" fmla="+- wR dx 0" /><gd name="x7" fmla="+- x3 dx 0" /><gd name="q6" fmla="+- aw 0 th" /><gd name="dh" fmla="*/ q6 1 2" /><gd name="x4" fmla="+- x5 0 dh" /><gd name="x8" fmla="+- x7 dh 0" /><gd name="aw2" fmla="*/ aw 1 2" /><gd name="x6" fmla="+- r 0 aw2" /><gd name="y1" fmla="+- t ah 0" /><gd name="swAng" fmla="at2 ah dx" /><gd name="mswAng" fmla="+- 0 0 swAng" /><gd name="iy" fmla="+- t idy 0" /><gd name="ix" fmla="+/ wR x3 2" /><gd name="q12" fmla="*/ th 1 2" /><gd name="dang2" fmla="at2 idy q12" /><gd name="swAng2" fmla="+- dang2 0 swAng" /><gd name="mswAng2" fmla="+- 0 0 swAng2" /><gd name="stAng3" fmla="+- cd4 0 swAng" /><gd name="swAng3" fmla="+- swAng dang2 0" /><gd name="stAng2" fmla="+- cd4 0 dang2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="a2"><pos x="x7" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="maxAdj2"><pos x="x4" y="t" /></ahXY><ahXY gdRefY="adj3" minY="0" maxY="maxAdj3"><pos x="r" y="y1" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x6" y="t" /></cxn><cxn ang="3cd4"><pos x="x4" y="y1" /></cxn><cxn ang="3cd4"><pos x="q12" y="t" /></cxn><cxn ang="cd4"><pos x="ix" y="b" /></cxn><cxn ang="0"><pos x="x8" y="y1" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="x6" y="t" /></moveTo><lnTo><pt x="x8" y="y1" /></lnTo><lnTo><pt x="x7" y="y1" /></lnTo><arcTo wR="wR" hR="h" stAng="stAng3" swAng="swAng3" /><arcTo wR="wR" hR="h" stAng="stAng2" swAng="swAng2" /><lnTo><pt x="x4" y="y1" /></lnTo><close /></path><path fill="darkenLess" stroke="false" extrusionOk="false"><moveTo><pt x="wR" y="b" /></moveTo><arcTo wR="wR" hR="h" stAng="cd4" swAng="cd4" /><lnTo><pt x="th" y="t" /></lnTo><arcTo wR="wR" hR="h" stAng="cd2" swAng="-5400000" /><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="ix" y="iy" /></moveTo><arcTo wR="wR" hR="h" stAng="stAng2" swAng="swAng2" /><lnTo><pt x="x4" y="y1" /></lnTo><lnTo><pt x="x6" y="t" /></lnTo><lnTo><pt x="x8" y="y1" /></lnTo><lnTo><pt x="x7" y="y1" /></lnTo><arcTo wR="wR" hR="h" stAng="stAng3" swAng="swAng" /><lnTo><pt x="wR" y="b" /></lnTo><arcTo wR="wR" hR="h" stAng="cd4" swAng="cd4" /><lnTo><pt x="th" y="t" /></lnTo><arcTo wR="wR" hR="h" stAng="cd2" swAng="-5400000" /></path></pathLst>';
var dt = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="vf" fmla="val 105146" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="shd2" fmla="*/ hd2 vf 100000" /><gd name="dx1" fmla="cos wd2 2160000" /><gd name="dx2" fmla="cos wd2 4320000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- hc dx2 0" /><gd name="x4" fmla="+- hc dx1 0" /><gd name="dy1" fmla="sin shd2 4320000" /><gd name="dy2" fmla="sin shd2 2160000" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y2" fmla="+- vc 0 dy2" /><gd name="y3" fmla="+- vc dy2 0" /><gd name="y4" fmla="+- vc dy1 0" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="x4" y="y2" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="0"><pos x="x4" y="y3" /></cxn><cxn ang="cd4"><pos x="x3" y="y4" /></cxn><cxn ang="cd4"><pos x="x2" y="y4" /></cxn><cxn ang="cd2"><pos x="x1" y="y3" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd2"><pos x="x1" y="y2" /></cxn><cxn ang="3cd4"><pos x="x2" y="y1" /></cxn><cxn ang="3cd4"><pos x="x3" y="y1" /></cxn></cxnLst><rect l="x1" t="y2" r="x4" b="y3" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="x1" y="y2" /></lnTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="x3" y="y1" /></lnTo><lnTo><pt x="x4" y="y2" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="x4" y="y3" /></lnTo><lnTo><pt x="x3" y="y4" /></lnTo><lnTo><pt x="x2" y="y4" /></lnTo><lnTo><pt x="x1" y="y3" /></lnTo><close /></path></pathLst>';
var xt = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 100000" /><gd name="x2" fmla="*/ w a 100000" /><gd name="x1" fmla="*/ x2 1 2" /><gd name="x3" fmla="+/ x2 r 2" /><gd name="y2" fmla="*/ h a 100000" /><gd name="y1" fmla="*/ y2 1 2" /><gd name="y3" fmla="+/ y2 b 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="100000"><pos x="l" y="y2" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="hc" y="vc" /></cxn><cxn ang="cd2"><pos x="l" y="y3" /></cxn><cxn ang="cd2"><pos x="x1" y="y1" /></cxn><cxn ang="3cd4"><pos x="x3" y="t" /></cxn></cxnLst><rect l="l" t="t" r="x3" b="y3" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y2" /></moveTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var gt = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="ir" fmla="*/ w 3 4" /><gd name="ib" fmla="*/ h 3 4" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="wd4" t="hd4" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="hc" y="b" /></lnTo><close /></path></pathLst>';
var ct = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x1" fmla="*/ w 2894 21600" /><gd name="x2" fmla="*/ w 7906 21600" /><gd name="x3" fmla="*/ w 13694 21600" /><gd name="x4" fmla="*/ w 18706 21600" /><gd name="y1" fmla="*/ h 2894 21600" /><gd name="y2" fmla="*/ h 7906 21600" /><gd name="y3" fmla="*/ h 13694 21600" /><gd name="y4" fmla="*/ h 18706 21600" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="x4" y="y1" /></cxn><cxn ang="0"><pos x="r" y="y2" /></cxn><cxn ang="0"><pos x="r" y="y3" /></cxn><cxn ang="0"><pos x="x4" y="y4" /></cxn><cxn ang="cd4"><pos x="x3" y="b" /></cxn><cxn ang="cd4"><pos x="x2" y="b" /></cxn><cxn ang="cd2"><pos x="x1" y="y4" /></cxn><cxn ang="cd2"><pos x="l" y="y3" /></cxn><cxn ang="cd2"><pos x="l" y="y2" /></cxn><cxn ang="cd2"><pos x="x1" y="y1" /></cxn><cxn ang="3cd4"><pos x="x2" y="t" /></cxn><cxn ang="3cd4"><pos x="x3" y="t" /></cxn></cxnLst><rect l="x1" t="y1" r="x4" b="y4" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y2" /></moveTo><lnTo><pt x="x1" y="y1" /></lnTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="x3" y="t" /></lnTo><lnTo><pt x="x4" y="y1" /></lnTo><lnTo><pt x="r" y="y2" /></lnTo><lnTo><pt x="r" y="y3" /></lnTo><lnTo><pt x="x4" y="y4" /></lnTo><lnTo><pt x="x3" y="b" /></lnTo><lnTo><pt x="x2" y="b" /></lnTo><lnTo><pt x="x1" y="y4" /></lnTo><lnTo><pt x="l" y="y3" /></lnTo><close /></path></pathLst>';
var rt = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="dr" fmla="*/ ss a 100000" /><gd name="iwd2" fmla="+- wd2 0 dr" /><gd name="ihd2" fmla="+- hd2 0 dr" /><gd name="idx" fmla="cos wd2 2700000" /><gd name="idy" fmla="sin hd2 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="ir" fmla="+- hc idx 0" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ib" fmla="+- vc idy 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefR="adj" minR="0" maxR="50000"><pos x="dr" y="vc" /></ahPolar></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="3cd4"><pos x="il" y="it" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="il" y="ib" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd4"><pos x="ir" y="ib" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="3cd4"><pos x="ir" y="it" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="cd2" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="3cd4" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="0" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="cd4" swAng="cd4" /><close /><moveTo><pt x="dr" y="vc" /></moveTo><arcTo wR="iwd2" hR="ihd2" stAng="cd2" swAng="-5400000" /><arcTo wR="iwd2" hR="ihd2" stAng="cd4" swAng="-5400000" /><arcTo wR="iwd2" hR="ihd2" stAng="0" swAng="-5400000" /><arcTo wR="iwd2" hR="ihd2" stAng="3cd4" swAng="-5400000" /><close /></path></pathLst>';
var pt = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 6250" /><gd name="adj2" fmla="val 0" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 12500" /><gd name="a2" fmla="pin -10000 adj2 10000" /><gd name="y1" fmla="*/ h a1 100000" /><gd name="dy2" fmla="*/ y1 10 3" /><gd name="y2" fmla="+- y1 0 dy2" /><gd name="y3" fmla="+- y1 dy2 0" /><gd name="y4" fmla="+- b 0 y1" /><gd name="y5" fmla="+- y4 0 dy2" /><gd name="y6" fmla="+- y4 dy2 0" /><gd name="dx1" fmla="*/ w a2 100000" /><gd name="of2" fmla="*/ w a2 50000" /><gd name="x1" fmla="abs dx1" /><gd name="dx2" fmla="?: of2 0 of2" /><gd name="x2" fmla="+- l 0 dx2" /><gd name="dx8" fmla="?: of2 of2 0" /><gd name="x8" fmla="+- r 0 dx8" /><gd name="dx3" fmla="+/ dx2 x8 6" /><gd name="x3" fmla="+- x2 dx3 0" /><gd name="dx4" fmla="+/ dx2 x8 3" /><gd name="x4" fmla="+- x2 dx4 0" /><gd name="x5" fmla="+/ x2 x8 2" /><gd name="x6" fmla="+- x5 dx3 0" /><gd name="x7" fmla="+/ x6 x8 2" /><gd name="x9" fmla="+- l dx8 0" /><gd name="x15" fmla="+- r dx2 0" /><gd name="x10" fmla="+- x9 dx3 0" /><gd name="x11" fmla="+- x9 dx4 0" /><gd name="x12" fmla="+/ x9 x15 2" /><gd name="x13" fmla="+- x12 dx3 0" /><gd name="x14" fmla="+/ x13 x15 2" /><gd name="x16" fmla="+- r 0 x1" /><gd name="xAdj" fmla="+- hc dx1 0" /><gd name="il" fmla="max x2 x9" /><gd name="ir" fmla="min x8 x15" /><gd name="it" fmla="*/ h a1 50000" /><gd name="ib" fmla="+- b 0 it" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="12500"><pos x="l" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="-10000" maxX="10000"><pos x="xAdj" y="b" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd4"><pos x="x12" y="y1" /></cxn><cxn ang="cd2"><pos x="x1" y="vc" /></cxn><cxn ang="3cd4"><pos x="x5" y="y4" /></cxn><cxn ang="0"><pos x="x16" y="vc" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x2" y="y1" /></moveTo><cubicBezTo><pt x="x3" y="y2" /><pt x="x4" y="y3" /><pt x="x5" y="y1" /></cubicBezTo><cubicBezTo><pt x="x6" y="y2" /><pt x="x7" y="y3" /><pt x="x8" y="y1" /></cubicBezTo><lnTo><pt x="x15" y="y4" /></lnTo><cubicBezTo><pt x="x14" y="y6" /><pt x="x13" y="y5" /><pt x="x12" y="y4" /></cubicBezTo><cubicBezTo><pt x="x11" y="y6" /><pt x="x10" y="y5" /><pt x="x9" y="y4" /></cubicBezTo><close /></path></pathLst>';
var it = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 50000" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 100000 h ss" /><gd name="a1" fmla="pin 0 adj1 100000" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="dy1" fmla="*/ ss a2 100000" /><gd name="y1" fmla="+- b 0 dy1" /><gd name="dx1" fmla="*/ w a1 200000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc dx1 0" /><gd name="dy2" fmla="*/ x1 dy1 wd2" /><gd name="y2" fmla="+- y1 dy2 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="100000"><pos x="x1" y="t" /></ahXY><ahXY gdRefY="adj2" minY="0" maxY="maxAdj2"><pos x="l" y="y1" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="y1" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="y1" /></cxn></cxnLst><rect l="x1" t="t" r="x2" b="y2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y1" /></moveTo><lnTo><pt x="x1" y="y1" /></lnTo><lnTo><pt x="x1" y="t" /></lnTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="r" y="y1" /></lnTo><lnTo><pt x="hc" y="b" /></lnTo><close /></path></pathLst>';
var ft = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 25000" /><gd name="adj3" fmla="val 25000" /><gd name="adj4" fmla="val 64977" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 50000 w ss" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="maxAdj1" fmla="*/ a2 2 1" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="maxAdj3" fmla="*/ 100000 h ss" /><gd name="a3" fmla="pin 0 adj3 maxAdj3" /><gd name="q2" fmla="*/ a3 ss h" /><gd name="maxAdj4" fmla="+- 100000 0 q2" /><gd name="a4" fmla="pin 0 adj4 maxAdj4" /><gd name="dx1" fmla="*/ ss a2 100000" /><gd name="dx2" fmla="*/ ss a1 200000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- hc dx2 0" /><gd name="x4" fmla="+- hc dx1 0" /><gd name="dy3" fmla="*/ ss a3 100000" /><gd name="y3" fmla="+- b 0 dy3" /><gd name="y2" fmla="*/ h a4 100000" /><gd name="y1" fmla="*/ y2 1 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="maxAdj1"><pos x="x2" y="y3" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="maxAdj2"><pos x="x1" y="b" /></ahXY><ahXY gdRefY="adj3" minY="0" maxY="maxAdj3"><pos x="r" y="y3" /></ahXY><ahXY gdRefY="adj4" minY="0" maxY="maxAdj4"><pos x="l" y="y2" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="y1" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="y1" /></cxn></cxnLst><rect l="l" t="t" r="r" b="y2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="y2" /></lnTo><lnTo><pt x="x3" y="y2" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo><lnTo><pt x="x4" y="y3" /></lnTo><lnTo><pt x="hc" y="b" /></lnTo><lnTo><pt x="x1" y="y3" /></lnTo><lnTo><pt x="x2" y="y3" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="l" y="y2" /></lnTo><close /></path></pathLst>';
var ht = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="idx" fmla="cos wd2 2700000" /><gd name="idy" fmla="sin hd2 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="ir" fmla="+- hc idx 0" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ib" fmla="+- vc idy 0" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="3cd4"><pos x="il" y="it" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="il" y="ib" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd4"><pos x="ir" y="ib" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="3cd4"><pos x="ir" y="it" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="cd2" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="3cd4" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="0" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="cd4" swAng="cd4" /><close /></path></pathLst>';
var yt = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 50000" /><gd name="adj3" fmla="val 12500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 100000" /><gd name="a2" fmla="pin 25000 adj2 75000" /><gd name="q10" fmla="+- 100000 0 a1" /><gd name="q11" fmla="*/ q10 1 2" /><gd name="q12" fmla="+- a1 0 q11" /><gd name="minAdj3" fmla="max 0 q12" /><gd name="a3" fmla="pin minAdj3 adj3 a1" /><gd name="dx2" fmla="*/ w a2 200000" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- x2 wd8 0" /><gd name="x4" fmla="+- r 0 x3" /><gd name="x5" fmla="+- r 0 x2" /><gd name="x6" fmla="+- r 0 wd8" /><gd name="dy1" fmla="*/ h a3 100000" /><gd name="f1" fmla="*/ 4 dy1 w" /><gd name="q1" fmla="*/ x3 x3 w" /><gd name="q2" fmla="+- x3 0 q1" /><gd name="y1" fmla="*/ f1 q2 1" /><gd name="cx1" fmla="*/ x3 1 2" /><gd name="cy1" fmla="*/ f1 cx1 1" /><gd name="cx2" fmla="+- r 0 cx1" /><gd name="q1" fmla="*/ h a1 100000" /><gd name="dy3" fmla="+- q1 0 dy1" /><gd name="q3" fmla="*/ x2 x2 w" /><gd name="q4" fmla="+- x2 0 q3" /><gd name="q5" fmla="*/ f1 q4 1" /><gd name="y3" fmla="+- q5 dy3 0" /><gd name="q6" fmla="+- dy1 dy3 y3" /><gd name="q7" fmla="+- q6 dy1 0" /><gd name="cy3" fmla="+- q7 dy3 0" /><gd name="rh" fmla="+- b 0 q1" /><gd name="q8" fmla="*/ dy1 14 16" /><gd name="y2" fmla="+/ q8 rh 2" /><gd name="y5" fmla="+- q5 rh 0" /><gd name="y6" fmla="+- y3 rh 0" /><gd name="cx4" fmla="*/ x2 1 2" /><gd name="q9" fmla="*/ f1 cx4 1" /><gd name="cy4" fmla="+- q9 rh 0" /><gd name="cx5" fmla="+- r 0 cx4" /><gd name="cy6" fmla="+- cy3 rh 0" /><gd name="y7" fmla="+- y1 dy3 0" /><gd name="cy7" fmla="+- q1 q1 y7" /><gd name="y8" fmla="+- b 0 dy1" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="100000"><pos x="hc" y="q1" /></ahXY><ahXY gdRefX="adj2" minX="25000" maxX="75000"><pos x="x2" y="b" /></ahXY><ahXY gdRefY="adj3" minY="minAdj3" maxY="a1"><pos x="l" y="y8" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="q1" /></cxn><cxn ang="cd2"><pos x="wd8" y="y2" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="x6" y="y2" /></cxn></cxnLst><rect l="x2" t="q1" r="x5" b="y6" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><quadBezTo><pt x="cx1" y="cy1" /><pt x="x3" y="y1" /></quadBezTo><lnTo><pt x="x2" y="y3" /></lnTo><quadBezTo><pt x="hc" y="cy3" /><pt x="x5" y="y3" /></quadBezTo><lnTo><pt x="x4" y="y1" /></lnTo><quadBezTo><pt x="cx2" y="cy1" /><pt x="r" y="t" /></quadBezTo><lnTo><pt x="x6" y="y2" /></lnTo><lnTo><pt x="r" y="rh" /></lnTo><quadBezTo><pt x="cx5" y="cy4" /><pt x="x5" y="y5" /></quadBezTo><lnTo><pt x="x5" y="y6" /></lnTo><quadBezTo><pt x="hc" y="cy6" /><pt x="x2" y="y6" /></quadBezTo><lnTo><pt x="x2" y="y5" /></lnTo><quadBezTo><pt x="cx4" y="cy4" /><pt x="l" y="rh" /></quadBezTo><lnTo><pt x="wd8" y="y2" /></lnTo><close /></path><path fill="darkenLess" stroke="false" extrusionOk="false"><moveTo><pt x="x3" y="y7" /></moveTo><lnTo><pt x="x3" y="y1" /></lnTo><lnTo><pt x="x2" y="y3" /></lnTo><quadBezTo><pt x="hc" y="cy3" /><pt x="x5" y="y3" /></quadBezTo><lnTo><pt x="x4" y="y1" /></lnTo><lnTo><pt x="x4" y="y7" /></lnTo><quadBezTo><pt x="hc" y="cy7" /><pt x="x3" y="y7" /></quadBezTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><quadBezTo><pt x="cx1" y="cy1" /><pt x="x3" y="y1" /></quadBezTo><lnTo><pt x="x2" y="y3" /></lnTo><quadBezTo><pt x="hc" y="cy3" /><pt x="x5" y="y3" /></quadBezTo><lnTo><pt x="x4" y="y1" /></lnTo><quadBezTo><pt x="cx2" y="cy1" /><pt x="r" y="t" /></quadBezTo><lnTo><pt x="x6" y="y2" /></lnTo><lnTo><pt x="r" y="rh" /></lnTo><quadBezTo><pt x="cx5" y="cy4" /><pt x="x5" y="y5" /></quadBezTo><lnTo><pt x="x5" y="y6" /></lnTo><quadBezTo><pt x="hc" y="cy6" /><pt x="x2" y="y6" /></quadBezTo><lnTo><pt x="x2" y="y5" /></lnTo><quadBezTo><pt x="cx4" y="cy4" /><pt x="l" y="rh" /></quadBezTo><lnTo><pt x="wd8" y="y2" /></lnTo><close /><moveTo><pt x="x2" y="y5" /></moveTo><lnTo><pt x="x2" y="y3" /></lnTo><moveTo><pt x="x5" y="y3" /></moveTo><lnTo><pt x="x5" y="y5" /></lnTo><moveTo><pt x="x3" y="y1" /></moveTo><lnTo><pt x="x3" y="y7" /></lnTo><moveTo><pt x="x4" y="y7" /></moveTo><lnTo><pt x="x4" y="y1" /></lnTo></path></pathLst>';
var Tt = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 50000" /><gd name="adj3" fmla="val 12500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 100000" /><gd name="a2" fmla="pin 25000 adj2 75000" /><gd name="q10" fmla="+- 100000 0 a1" /><gd name="q11" fmla="*/ q10 1 2" /><gd name="q12" fmla="+- a1 0 q11" /><gd name="minAdj3" fmla="max 0 q12" /><gd name="a3" fmla="pin minAdj3 adj3 a1" /><gd name="dx2" fmla="*/ w a2 200000" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- x2 wd8 0" /><gd name="x4" fmla="+- r 0 x3" /><gd name="x5" fmla="+- r 0 x2" /><gd name="x6" fmla="+- r 0 wd8" /><gd name="dy1" fmla="*/ h a3 100000" /><gd name="f1" fmla="*/ 4 dy1 w" /><gd name="q1" fmla="*/ x3 x3 w" /><gd name="q2" fmla="+- x3 0 q1" /><gd name="u1" fmla="*/ f1 q2 1" /><gd name="y1" fmla="+- b 0 u1" /><gd name="cx1" fmla="*/ x3 1 2" /><gd name="cu1" fmla="*/ f1 cx1 1" /><gd name="cy1" fmla="+- b 0 cu1" /><gd name="cx2" fmla="+- r 0 cx1" /><gd name="q1" fmla="*/ h a1 100000" /><gd name="dy3" fmla="+- q1 0 dy1" /><gd name="q3" fmla="*/ x2 x2 w" /><gd name="q4" fmla="+- x2 0 q3" /><gd name="q5" fmla="*/ f1 q4 1" /><gd name="u3" fmla="+- q5 dy3 0" /><gd name="y3" fmla="+- b 0 u3" /><gd name="q6" fmla="+- dy1 dy3 u3" /><gd name="q7" fmla="+- q6 dy1 0" /><gd name="cu3" fmla="+- q7 dy3 0" /><gd name="cy3" fmla="+- b 0 cu3" /><gd name="rh" fmla="+- b 0 q1" /><gd name="q8" fmla="*/ dy1 14 16" /><gd name="u2" fmla="+/ q8 rh 2" /><gd name="y2" fmla="+- b 0 u2" /><gd name="u5" fmla="+- q5 rh 0" /><gd name="y5" fmla="+- b 0 u5" /><gd name="u6" fmla="+- u3 rh 0" /><gd name="y6" fmla="+- b 0 u6" /><gd name="cx4" fmla="*/ x2 1 2" /><gd name="q9" fmla="*/ f1 cx4 1" /><gd name="cu4" fmla="+- q9 rh 0" /><gd name="cy4" fmla="+- b 0 cu4" /><gd name="cx5" fmla="+- r 0 cx4" /><gd name="cu6" fmla="+- cu3 rh 0" /><gd name="cy6" fmla="+- b 0 cu6" /><gd name="u7" fmla="+- u1 dy3 0" /><gd name="y7" fmla="+- b 0 u7" /><gd name="cu7" fmla="+- q1 q1 u7" /><gd name="cy7" fmla="+- b 0 cu7" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="100000"><pos x="hc" y="rh" /></ahXY><ahXY gdRefX="adj2" minX="25000" maxX="100000"><pos x="x2" y="t" /></ahXY><ahXY gdRefY="adj3" minY="minAdj3" maxY="a1"><pos x="l" y="dy1" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="wd8" y="y2" /></cxn><cxn ang="cd4"><pos x="hc" y="rh" /></cxn><cxn ang="0"><pos x="x6" y="y2" /></cxn></cxnLst><rect l="x2" t="y6" r="x5" b="rh" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="b" /></moveTo><quadBezTo><pt x="cx1" y="cy1" /><pt x="x3" y="y1" /></quadBezTo><lnTo><pt x="x2" y="y3" /></lnTo><quadBezTo><pt x="hc" y="cy3" /><pt x="x5" y="y3" /></quadBezTo><lnTo><pt x="x4" y="y1" /></lnTo><quadBezTo><pt x="cx2" y="cy1" /><pt x="r" y="b" /></quadBezTo><lnTo><pt x="x6" y="y2" /></lnTo><lnTo><pt x="r" y="q1" /></lnTo><quadBezTo><pt x="cx5" y="cy4" /><pt x="x5" y="y5" /></quadBezTo><lnTo><pt x="x5" y="y6" /></lnTo><quadBezTo><pt x="hc" y="cy6" /><pt x="x2" y="y6" /></quadBezTo><lnTo><pt x="x2" y="y5" /></lnTo><quadBezTo><pt x="cx4" y="cy4" /><pt x="l" y="q1" /></quadBezTo><lnTo><pt x="wd8" y="y2" /></lnTo><close /></path><path fill="darkenLess" stroke="false" extrusionOk="false"><moveTo><pt x="x3" y="y7" /></moveTo><lnTo><pt x="x3" y="y1" /></lnTo><lnTo><pt x="x2" y="y3" /></lnTo><quadBezTo><pt x="hc" y="cy3" /><pt x="x5" y="y3" /></quadBezTo><lnTo><pt x="x4" y="y1" /></lnTo><lnTo><pt x="x4" y="y7" /></lnTo><quadBezTo><pt x="hc" y="cy7" /><pt x="x3" y="y7" /></quadBezTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="wd8" y="y2" /></lnTo><lnTo><pt x="l" y="q1" /></lnTo><quadBezTo><pt x="cx4" y="cy4" /><pt x="x2" y="y5" /></quadBezTo><lnTo><pt x="x2" y="y6" /></lnTo><quadBezTo><pt x="hc" y="cy6" /><pt x="x5" y="y6" /></quadBezTo><lnTo><pt x="x5" y="y5" /></lnTo><quadBezTo><pt x="cx5" y="cy4" /><pt x="r" y="q1" /></quadBezTo><lnTo><pt x="x6" y="y2" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><quadBezTo><pt x="cx2" y="cy1" /><pt x="x4" y="y1" /></quadBezTo><lnTo><pt x="x5" y="y3" /></lnTo><quadBezTo><pt x="hc" y="cy3" /><pt x="x2" y="y3" /></quadBezTo><lnTo><pt x="x3" y="y1" /></lnTo><quadBezTo><pt x="cx1" y="cy1" /><pt x="l" y="b" /></quadBezTo><close /><moveTo><pt x="x2" y="y3" /></moveTo><lnTo><pt x="x2" y="y5" /></lnTo><moveTo><pt x="x5" y="y5" /></moveTo><lnTo><pt x="x5" y="y3" /></lnTo><moveTo><pt x="x3" y="y7" /></moveTo><lnTo><pt x="x3" y="y1" /></lnTo><moveTo><pt x="x4" y="y1" /></moveTo><lnTo><pt x="x4" y="y7" /></lnTo></path></pathLst>';
var wt = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x2" fmla="+- r 0 ssd6" /><gd name="y2" fmla="+- b 0 ssd6" /><gd name="il" fmla="*/ ssd6 29289 100000" /><gd name="ir" fmla="+- r 0 il" /><gd name="ib" fmla="+- b 0 il" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="il" t="il" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="ssd6" /></moveTo><arcTo wR="ssd6" hR="ssd6" stAng="cd2" swAng="cd4" /><lnTo><pt x="x2" y="t" /></lnTo><arcTo wR="ssd6" hR="ssd6" stAng="3cd4" swAng="cd4" /><lnTo><pt x="r" y="y2" /></lnTo><arcTo wR="ssd6" hR="ssd6" stAng="0" swAng="cd4" /><lnTo><pt x="ssd6" y="b" /></lnTo><arcTo wR="ssd6" hR="ssd6" stAng="cd4" swAng="cd4" /><close /></path></pathLst>';
var vt = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="ir" fmla="*/ w 3 4" /><gd name="ib" fmla="*/ h 3 4" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="3cd4"><pos x="hc" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn></cxnLst><rect l="wd4" t="hd4" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="2" h="2"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="2" y="0" /></lnTo><lnTo><pt x="1" y="1" /></lnTo><lnTo><pt x="2" y="2" /></lnTo><lnTo><pt x="0" y="2" /></lnTo><lnTo><pt x="1" y="1" /></lnTo><close /></path></pathLst>';
var Lt = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="idx" fmla="cos wd2 2700000" /><gd name="idy" fmla="sin hd2 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="ir" fmla="+- hc idx 0" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ib" fmla="+- vc idy 0" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="3cd4"><pos x="il" y="it" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="il" y="ib" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd4"><pos x="ir" y="ib" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="3cd4"><pos x="ir" y="it" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="cd2" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="3cd4" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="0" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="cd4" swAng="cd4" /><close /></path></pathLst>';
var ut = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="ir" fmla="*/ w 3 4" /><gd name="ib" fmla="*/ h 3 4" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="wd4" t="hd4" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="2" h="2"><moveTo><pt x="0" y="1" /></moveTo><lnTo><pt x="1" y="0" /></lnTo><lnTo><pt x="2" y="1" /></lnTo><lnTo><pt x="1" y="2" /></lnTo><close /></path></pathLst>';
var At = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="idx" fmla="cos wd2 2700000" /><gd name="idy" fmla="sin hd2 2700000" /><gd name="ir" fmla="+- hc idx 0" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ib" fmla="+- vc idy 0" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="hc" y="t" /></lnTo><arcTo wR="wd2" hR="hd2" stAng="3cd4" swAng="cd2" /><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var bt = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x2" fmla="*/ w 5 6" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="wd6" t="t" r="x2" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="6" h="6"><moveTo><pt x="0" y="3" /></moveTo><lnTo><pt x="1" y="0" /></lnTo><lnTo><pt x="5" y="0" /></lnTo><arcTo wR="1" hR="3" stAng="3cd4" swAng="cd2" /><lnTo><pt x="1" y="6" /></lnTo><close /></path></pathLst>';
var jt = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y1" fmla="*/ h 17322 21600" /><gd name="y2" fmla="*/ h 20172 21600" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="y2" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="t" r="r" b="y1" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="21600" h="21600"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="21600" y="0" /></lnTo><lnTo><pt x="21600" y="17322" /></lnTo><cubicBezTo><pt x="10800" y="17322" /><pt x="10800" y="23922" /><pt x="0" y="20172" /></cubicBezTo><close /></path></pathLst>';
var $t = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x2" fmla="*/ w 3 4" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="wd4" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="x2" y="vc" /></cxn></cxnLst><rect l="wd4" t="vc" r="x2" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="2" h="2"><moveTo><pt x="0" y="2" /></moveTo><lnTo><pt x="1" y="0" /></lnTo><lnTo><pt x="2" y="2" /></lnTo><close /></path></pathLst>';
var Rt = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x3" fmla="*/ w 2 5" /><gd name="x4" fmla="*/ w 3 5" /><gd name="x5" fmla="*/ w 4 5" /><gd name="x6" fmla="*/ w 9 10" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x4" y="t" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="wd10" y="vc" /></cxn><cxn ang="cd4"><pos x="x3" y="b" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="x6" y="vc" /></cxn></cxnLst><rect l="wd5" t="t" r="x5" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="5" h="5"><moveTo><pt x="0" y="5" /></moveTo><lnTo><pt x="1" y="0" /></lnTo><lnTo><pt x="5" y="0" /></lnTo><lnTo><pt x="4" y="5" /></lnTo><close /></path></pathLst>';
var Yt = '<cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="wd8" t="hd8" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false" w="1" h="1"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="1" y="0" /></lnTo><lnTo><pt x="1" y="1" /></lnTo><lnTo><pt x="0" y="1" /></lnTo><close /></path><path fill="none" extrusionOk="false" w="8" h="8"><moveTo><pt x="1" y="0" /></moveTo><lnTo><pt x="1" y="8" /></lnTo><moveTo><pt x="0" y="1" /></moveTo><lnTo><pt x="8" y="1" /></lnTo></path><path fill="none" w="1" h="1"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="1" y="0" /></lnTo><lnTo><pt x="1" y="1" /></lnTo><lnTo><pt x="0" y="1" /></lnTo><close /></path></pathLst>';
var Xt = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y3" fmla="*/ h 5 6" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="hd3" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="hd3" r="r" b="y3" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false" w="6" h="6"><moveTo><pt x="0" y="1" /></moveTo><arcTo wR="3" hR="1" stAng="cd2" swAng="cd2" /><lnTo><pt x="6" y="5" /></lnTo><arcTo wR="3" hR="1" stAng="0" swAng="cd2" /><close /></path><path fill="none" extrusionOk="false" w="6" h="6"><moveTo><pt x="6" y="1" /></moveTo><arcTo wR="3" hR="1" stAng="0" swAng="cd2" /></path><path fill="none" w="6" h="6"><moveTo><pt x="0" y="1" /></moveTo><arcTo wR="3" hR="1" stAng="cd2" swAng="cd2" /><lnTo><pt x="6" y="5" /></lnTo><arcTo wR="3" hR="1" stAng="0" swAng="cd2" /><close /></path></pathLst>';
var Ct = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x2" fmla="*/ w 2 3" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="x2" y="vc" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="wd6" t="t" r="x2" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false" w="6" h="6"><moveTo><pt x="1" y="0" /></moveTo><lnTo><pt x="5" y="0" /></lnTo><arcTo wR="1" hR="3" stAng="3cd4" swAng="cd2" /><lnTo><pt x="1" y="6" /></lnTo><arcTo wR="1" hR="3" stAng="cd4" swAng="cd2" /><close /></path><path fill="none" extrusionOk="false" w="6" h="6"><moveTo><pt x="5" y="6" /></moveTo><arcTo wR="1" hR="3" stAng="cd4" swAng="cd2" /></path><path fill="none" w="6" h="6"><moveTo><pt x="1" y="0" /></moveTo><lnTo><pt x="5" y="0" /></lnTo><arcTo wR="1" hR="3" stAng="3cd4" swAng="cd2" /><lnTo><pt x="1" y="6" /></lnTo><arcTo wR="1" hR="3" stAng="cd4" swAng="cd2" /><close /></path></pathLst>';
var Ft = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="idx" fmla="cos wd2 2700000" /><gd name="idy" fmla="sin hd2 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="ir" fmla="+- hc idx 0" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ib" fmla="+- vc idy 0" /><gd name="ang1" fmla="at2 w h" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="hc" y="b" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="cd4" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="cd2" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="3cd4" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="0" swAng="ang1" /><lnTo><pt x="r" y="ib" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><close /></path></pathLst>';
var Bt = '<cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="hd10" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="hd5" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="5" h="5"><moveTo><pt x="0" y="1" /></moveTo><lnTo><pt x="5" y="0" /></lnTo><lnTo><pt x="5" y="5" /></lnTo><lnTo><pt x="0" y="5" /></lnTo><close /></path></pathLst>';
var kt = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x3" fmla="*/ w 4 5" /><gd name="x4" fmla="*/ w 9 10" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="wd10" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="x4" y="vc" /></cxn></cxnLst><rect l="wd5" t="t" r="x3" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="5" h="5"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="5" y="0" /></lnTo><lnTo><pt x="4" y="5" /></lnTo><lnTo><pt x="1" y="5" /></lnTo><close /></path></pathLst>';
var qt = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x2" fmla="*/ w 3 4" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="wd4" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="x2" y="vc" /></cxn></cxnLst><rect l="wd4" t="t" r="x2" b="vc" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="2" h="2"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="2" y="0" /></lnTo><lnTo><pt x="1" y="2" /></lnTo><close /></path></pathLst>';
var Mt = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y2" fmla="*/ h 3675 21600" /><gd name="y8" fmla="*/ h 20782 21600" /><gd name="x3" fmla="*/ w 9298 21600" /><gd name="x4" fmla="*/ w 12286 21600" /><gd name="x5" fmla="*/ w 18595 21600" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x4" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="x3" y="y8" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="y2" r="x5" b="y8" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false" w="21600" h="21600"><moveTo><pt x="0" y="20782" /></moveTo><cubicBezTo><pt x="9298" y="23542" /><pt x="9298" y="18022" /><pt x="18595" y="18022" /></cubicBezTo><lnTo><pt x="18595" y="3675" /></lnTo><lnTo><pt x="0" y="3675" /></lnTo><close /><moveTo><pt x="1532" y="3675" /></moveTo><lnTo><pt x="1532" y="1815" /></lnTo><lnTo><pt x="20000" y="1815" /></lnTo><lnTo><pt x="20000" y="16252" /></lnTo><cubicBezTo><pt x="19298" y="16252" /><pt x="18595" y="16352" /><pt x="18595" y="16352" /></cubicBezTo><lnTo><pt x="18595" y="3675" /></lnTo><close /><moveTo><pt x="2972" y="1815" /></moveTo><lnTo><pt x="2972" y="0" /></lnTo><lnTo><pt x="21600" y="0" /></lnTo><lnTo><pt x="21600" y="14392" /></lnTo><cubicBezTo><pt x="20800" y="14392" /><pt x="20000" y="14467" /><pt x="20000" y="14467" /></cubicBezTo><lnTo><pt x="20000" y="1815" /></lnTo><close /></path><path fill="none" extrusionOk="false" w="21600" h="21600"><moveTo><pt x="0" y="3675" /></moveTo><lnTo><pt x="18595" y="3675" /></lnTo><lnTo><pt x="18595" y="18022" /></lnTo><cubicBezTo><pt x="9298" y="18022" /><pt x="9298" y="23542" /><pt x="0" y="20782" /></cubicBezTo><close /><moveTo><pt x="1532" y="3675" /></moveTo><lnTo><pt x="1532" y="1815" /></lnTo><lnTo><pt x="20000" y="1815" /></lnTo><lnTo><pt x="20000" y="16252" /></lnTo><cubicBezTo><pt x="19298" y="16252" /><pt x="18595" y="16352" /><pt x="18595" y="16352" /></cubicBezTo><moveTo><pt x="2972" y="1815" /></moveTo><lnTo><pt x="2972" y="0" /></lnTo><lnTo><pt x="21600" y="0" /></lnTo><lnTo><pt x="21600" y="14392" /></lnTo><cubicBezTo><pt x="20800" y="14392" /><pt x="20000" y="14467" /><pt x="20000" y="14467" /></cubicBezTo></path><path stroke="false" fill="none" w="21600" h="21600"><moveTo><pt x="0" y="20782" /></moveTo><cubicBezTo><pt x="9298" y="23542" /><pt x="9298" y="18022" /><pt x="18595" y="18022" /></cubicBezTo><lnTo><pt x="18595" y="16352" /></lnTo><cubicBezTo><pt x="18595" y="16352" /><pt x="19298" y="16252" /><pt x="20000" y="16252" /></cubicBezTo><lnTo><pt x="20000" y="14467" /></lnTo><cubicBezTo><pt x="20000" y="14467" /><pt x="20800" y="14392" /><pt x="21600" y="14392" /></cubicBezTo><lnTo><pt x="21600" y="0" /></lnTo><lnTo><pt x="2972" y="0" /></lnTo><lnTo><pt x="2972" y="1815" /></lnTo><lnTo><pt x="1532" y="1815" /></lnTo><lnTo><pt x="1532" y="3675" /></lnTo><lnTo><pt x="0" y="3675" /></lnTo><close /></path></pathLst>';
var Pt = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x4" fmla="*/ w 3 4" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="x4" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="wd4" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="wd4" t="t" r="x4" b="vc" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false" w="2" h="2"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="2" y="0" /></lnTo><lnTo><pt x="1" y="2" /></lnTo><close /></path><path fill="none" extrusionOk="false" w="5" h="5"><moveTo><pt x="2" y="4" /></moveTo><lnTo><pt x="3" y="4" /></lnTo></path><path fill="none" extrusionOk="true" w="2" h="2"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="2" y="0" /></lnTo><lnTo><pt x="1" y="2" /></lnTo><close /></path></pathLst>';
var St = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y1" fmla="*/ h 4 5" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="t" r="r" b="y1" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="10" h="10"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="10" y="0" /></lnTo><lnTo><pt x="10" y="8" /></lnTo><lnTo><pt x="5" y="10" /></lnTo><lnTo><pt x="0" y="8" /></lnTo><close /></path></pathLst>';
var Ot = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x2" fmla="*/ w 5 6" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="x2" y="vc" /></cxn></cxnLst><rect l="wd6" t="t" r="x2" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="6" h="6"><moveTo><pt x="1" y="0" /></moveTo><lnTo><pt x="6" y="0" /></lnTo><arcTo wR="1" hR="3" stAng="3cd4" swAng="-10800000" /><lnTo><pt x="1" y="6" /></lnTo><arcTo wR="1" hR="3" stAng="cd4" swAng="cd2" /><close /></path></pathLst>';
var It = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="idx" fmla="cos wd2 2700000" /><gd name="idy" fmla="sin hd2 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="ir" fmla="+- hc idx 0" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ib" fmla="+- vc idy 0" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="3cd4"><pos x="il" y="it" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="il" y="ib" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd4"><pos x="ir" y="ib" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="3cd4"><pos x="ir" y="it" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="vc" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="cd2" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="3cd4" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="0" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="cd4" swAng="cd4" /><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="hc" y="t" /></moveTo><lnTo><pt x="hc" y="b" /></lnTo><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="r" y="vc" /></lnTo></path><path fill="none"><moveTo><pt x="l" y="vc" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="cd2" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="3cd4" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="0" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="cd4" swAng="cd4" /><close /></path></pathLst>';
var Dt = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x2" fmla="*/ w 7 8" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="wd8" t="t" r="x2" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false" w="1" h="1"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="1" y="0" /></lnTo><lnTo><pt x="1" y="1" /></lnTo><lnTo><pt x="0" y="1" /></lnTo><close /></path><path fill="none" extrusionOk="false" w="8" h="8"><moveTo><pt x="1" y="0" /></moveTo><lnTo><pt x="1" y="8" /></lnTo><moveTo><pt x="7" y="0" /></moveTo><lnTo><pt x="7" y="8" /></lnTo></path><path fill="none" w="1" h="1"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="1" y="0" /></lnTo><lnTo><pt x="1" y="1" /></lnTo><lnTo><pt x="0" y="1" /></lnTo><close /></path></pathLst>';
var Et = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x2" fmla="*/ w 4 5" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="wd5" t="t" r="x2" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="10" h="10"><moveTo><pt x="0" y="5" /></moveTo><lnTo><pt x="2" y="0" /></lnTo><lnTo><pt x="8" y="0" /></lnTo><lnTo><pt x="10" y="5" /></lnTo><lnTo><pt x="8" y="10" /></lnTo><lnTo><pt x="2" y="10" /></lnTo><close /></path></pathLst>';
var zt = '<cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="1" h="1"><moveTo><pt x="0" y="0" /></moveTo><lnTo><pt x="1" y="0" /></lnTo><lnTo><pt x="1" y="1" /></lnTo><lnTo><pt x="0" y="1" /></lnTo><close /></path></pathLst>';
var Gt = '<cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="hd5" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="5" h="5"><moveTo><pt x="0" y="1" /></moveTo><lnTo><pt x="1" y="0" /></lnTo><lnTo><pt x="5" y="0" /></lnTo><lnTo><pt x="5" y="5" /></lnTo><lnTo><pt x="0" y="5" /></lnTo><close /></path></pathLst>';
var Ht = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="y2" fmla="*/ h 9 10" /><gd name="ib" fmla="*/ h 4 5" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="hd10" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="y2" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="hd5" r="r" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="20" h="20"><moveTo><pt x="0" y="2" /></moveTo><arcTo wR="5" hR="2" stAng="cd2" swAng="-10800000" /><arcTo wR="5" hR="2" stAng="cd2" swAng="cd2" /><lnTo><pt x="20" y="18" /></lnTo><arcTo wR="5" hR="2" stAng="0" swAng="-10800000" /><arcTo wR="5" hR="2" stAng="0" swAng="cd2" /><close /></path></pathLst>';
var Nt = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="ir" fmla="*/ w 3 4" /><gd name="ib" fmla="*/ h 3 4" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="wd4" t="hd4" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false" w="2" h="2"><moveTo><pt x="0" y="1" /></moveTo><lnTo><pt x="1" y="0" /></lnTo><lnTo><pt x="2" y="1" /></lnTo><lnTo><pt x="1" y="2" /></lnTo><close /></path><path fill="none" extrusionOk="false" w="2" h="2"><moveTo><pt x="0" y="1" /></moveTo><lnTo><pt x="2" y="1" /></lnTo></path><path fill="none" w="2" h="2"><moveTo><pt x="0" y="1" /></moveTo><lnTo><pt x="1" y="0" /></lnTo><lnTo><pt x="2" y="1" /></lnTo><lnTo><pt x="1" y="2" /></lnTo><close /></path></pathLst>';
var Zt = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="idx" fmla="cos wd2 2700000" /><gd name="idy" fmla="sin hd2 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="ir" fmla="+- hc idx 0" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ib" fmla="+- vc idy 0" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="3cd4"><pos x="il" y="it" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="il" y="ib" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd4"><pos x="ir" y="ib" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="3cd4"><pos x="ir" y="it" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="vc" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="cd2" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="3cd4" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="0" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="cd4" swAng="cd4" /><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="il" y="it" /></moveTo><lnTo><pt x="ir" y="ib" /></lnTo><moveTo><pt x="ir" y="it" /></moveTo><lnTo><pt x="il" y="ib" /></lnTo></path><path fill="none"><moveTo><pt x="l" y="vc" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="cd2" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="3cd4" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="0" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="cd4" swAng="cd4" /><close /></path></pathLst>';
var _t = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="il" fmla="*/ w 1018 21600" /><gd name="ir" fmla="*/ w 20582 21600" /><gd name="it" fmla="*/ h 3163 21600" /><gd name="ib" fmla="*/ h 18437 21600" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="21600" h="21600"><moveTo><pt x="3475" y="0" /></moveTo><lnTo><pt x="18125" y="0" /></lnTo><arcTo wR="3475" hR="10800" stAng="3cd4" swAng="cd2" /><lnTo><pt x="3475" y="21600" /></lnTo><arcTo wR="3475" hR="10800" stAng="cd4" swAng="cd2" /><close /></path></pathLst>';
var Vt = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 16667" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="dy2" fmla="*/ ss a 100000" /><gd name="dy1" fmla="*/ dy2 1 5" /><gd name="x1" fmla="+- r 0 dy2" /><gd name="x2" fmla="+- x1 dy1 0" /><gd name="y2" fmla="+- b 0 dy2" /><gd name="y1" fmla="+- y2 dy1 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="50000"><pos x="x1" y="b" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="t" r="r" b="y2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="y2" /></lnTo><lnTo><pt x="x1" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path stroke="false" fill="darkenLess" extrusionOk="false"><moveTo><pt x="x1" y="b" /></moveTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="r" y="y2" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="b" /></moveTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="r" y="y2" /></lnTo><lnTo><pt x="x1" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><lnTo><pt x="l" y="t" /></lnTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="y2" /></lnTo></path></pathLst>';
var Wt = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 12500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 50000" /><gd name="x1" fmla="*/ ss a1 100000" /><gd name="x4" fmla="+- r 0 x1" /><gd name="y4" fmla="+- b 0 x1" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="50000"><pos x="x1" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="x1" t="x1" r="x4" b="y4" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /><moveTo><pt x="x1" y="x1" /></moveTo><lnTo><pt x="x1" y="y4" /></lnTo><lnTo><pt x="x4" y="y4" /></lnTo><lnTo><pt x="x4" y="x1" /></lnTo><close /></path></pathLst>';
var Qt = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="d" fmla="*/ ss 1 20" /><gd name="rw2" fmla="+- wd2 0 d" /><gd name="rh2" fmla="+- hd4 0 d" /><gd name="t1" fmla="cos wd2 480000" /><gd name="t2" fmla="sin hd4 480000" /><gd name="da" fmla="at2 t1 t2" /><gd name="2da" fmla="*/ da 2 1" /><gd name="stAng1" fmla="+- cd2 0 da" /><gd name="swAng1" fmla="+- cd2 2da 0" /><gd name="swAng3" fmla="+- cd2 0 2da" /><gd name="rw3" fmla="*/ wd2 1 4" /><gd name="rh3" fmla="*/ hd4 1 4" /><gd name="ct1" fmla="cos hd4 stAng1" /><gd name="st1" fmla="sin wd2 stAng1" /><gd name="m1" fmla="mod ct1 st1 0" /><gd name="n1" fmla="*/ wd2 hd4 m1" /><gd name="dx1" fmla="cos n1 stAng1" /><gd name="dy1" fmla="sin n1 stAng1" /><gd name="x1" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- hd4 dy1 0" /><gd name="ct3" fmla="cos rh3 da" /><gd name="st3" fmla="sin rw3 da" /><gd name="m3" fmla="mod ct3 st3 0" /><gd name="n3" fmla="*/ rw3 rh3 m3" /><gd name="dx3" fmla="cos n3 da" /><gd name="dy3" fmla="sin n3 da" /><gd name="x3" fmla="+- hc dx3 0" /><gd name="vc3" fmla="+- b 0 rh3" /><gd name="y2" fmla="+- vc3 dy3 0" /><gd name="x2" fmla="+- wd2 0 rw2" /><gd name="cd" fmla="*/ cd2 2 1" /></gdLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y1" /></moveTo><arcTo hR="hd4" wR="wd2" stAng="stAng1" swAng="swAng1" /><lnTo><pt x="x3" y="y2" /></lnTo><arcTo hR="rh3" wR="rw3" stAng="da" swAng="swAng3" /><close /><moveTo><pt x="x2" y="hd4" /></moveTo><arcTo hR="rh2" wR="rw2" stAng="cd2" swAng="-21600000" /><close /></path></pathLst>';
var Ut = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 15000" /><gd name="adj2" fmla="val 3526" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 20000" /><gd name="a2" fmla="pin 0 adj2 5358" /><gd name="th" fmla="*/ ss a1 100000" /><gd name="lFD" fmla="*/ ss a2 100000" /><gd name="th2" fmla="*/ th 1 2" /><gd name="l2" fmla="*/ lFD 1 2" /><gd name="l3" fmla="+- th2 l2 0" /><gd name="rh" fmla="+- hd2 0 th" /><gd name="rw" fmla="+- wd2 0 th" /><gd name="dr" fmla="+- rw 0 rh" /><gd name="maxr" fmla="?: dr rh rw" /><gd name="ha" fmla="at2 maxr l3" /><gd name="aA1" fmla="+- 19800000 0 ha" /><gd name="aD1" fmla="+- 19800000 ha 0" /><gd name="ta11" fmla="cos rw aA1" /><gd name="ta12" fmla="sin rh aA1" /><gd name="bA1" fmla="at2 ta11 ta12" /><gd name="cta1" fmla="cos rh bA1" /><gd name="sta1" fmla="sin rw bA1" /><gd name="ma1" fmla="mod cta1 sta1 0" /><gd name="na1" fmla="*/ rw rh ma1" /><gd name="dxa1" fmla="cos na1 bA1" /><gd name="dya1" fmla="sin na1 bA1" /><gd name="xA1" fmla="+- hc dxa1 0" /><gd name="yA1" fmla="+- vc dya1 0" /><gd name="td11" fmla="cos rw aD1" /><gd name="td12" fmla="sin rh aD1" /><gd name="bD1" fmla="at2 td11 td12" /><gd name="ctd1" fmla="cos rh bD1" /><gd name="std1" fmla="sin rw bD1" /><gd name="md1" fmla="mod ctd1 std1 0" /><gd name="nd1" fmla="*/ rw rh md1" /><gd name="dxd1" fmla="cos nd1 bD1" /><gd name="dyd1" fmla="sin nd1 bD1" /><gd name="xD1" fmla="+- hc dxd1 0" /><gd name="yD1" fmla="+- vc dyd1 0" /><gd name="xAD1" fmla="+- xA1 0 xD1" /><gd name="yAD1" fmla="+- yA1 0 yD1" /><gd name="lAD1" fmla="mod xAD1 yAD1 0" /><gd name="a12" fmla="at2 yAD1 xAD1" /><gd name="dxF1" fmla="sin lFD a12" /><gd name="dyF1" fmla="cos lFD a12" /><gd name="xF1" fmla="+- xD1 dxF1 0" /><gd name="yF1" fmla="+- yD1 dyF1 0" /><gd name="xE1" fmla="+- xA1 0 dxF1" /><gd name="yE1" fmla="+- yA1 0 dyF1" /><gd name="yC1t" fmla="sin th a12" /><gd name="xC1t" fmla="cos th a12" /><gd name="yC1" fmla="+- yF1 yC1t 0" /><gd name="xC1" fmla="+- xF1 0 xC1t" /><gd name="yB1" fmla="+- yE1 yC1t 0" /><gd name="xB1" fmla="+- xE1 0 xC1t" /><gd name="aD6" fmla="+- 3cd4 ha 0" /><gd name="td61" fmla="cos rw aD6" /><gd name="td62" fmla="sin rh aD6" /><gd name="bD6" fmla="at2 td61 td62" /><gd name="ctd6" fmla="cos rh bD6" /><gd name="std6" fmla="sin rw bD6" /><gd name="md6" fmla="mod ctd6 std6 0" /><gd name="nd6" fmla="*/ rw rh md6" /><gd name="dxd6" fmla="cos nd6 bD6" /><gd name="dyd6" fmla="sin nd6 bD6" /><gd name="xD6" fmla="+- hc dxd6 0" /><gd name="yD6" fmla="+- vc dyd6 0" /><gd name="xA6" fmla="+- hc 0 dxd6" /><gd name="xF6" fmla="+- xD6 0 lFD" /><gd name="xE6" fmla="+- xA6 lFD 0" /><gd name="yC6" fmla="+- yD6 0 th" /><gd name="swAng1" fmla="+- bA1 0 bD6" /><gd name="aA2" fmla="+- 1800000 0 ha" /><gd name="aD2" fmla="+- 1800000 ha 0" /><gd name="ta21" fmla="cos rw aA2" /><gd name="ta22" fmla="sin rh aA2" /><gd name="bA2" fmla="at2 ta21 ta22" /><gd name="yA2" fmla="+- h 0 yD1" /><gd name="td21" fmla="cos rw aD2" /><gd name="td22" fmla="sin rh aD2" /><gd name="bD2" fmla="at2 td21 td22" /><gd name="yD2" fmla="+- h 0 yA1" /><gd name="yC2" fmla="+- h 0 yB1" /><gd name="yB2" fmla="+- h 0 yC1" /><gd name="xB2" fmla="val xC1" /><gd name="swAng2" fmla="+- bA2 0 bD1" /><gd name="aD3" fmla="+- cd4 ha 0" /><gd name="td31" fmla="cos rw aD3" /><gd name="td32" fmla="sin rh aD3" /><gd name="bD3" fmla="at2 td31 td32" /><gd name="yD3" fmla="+- h 0 yD6" /><gd name="yB3" fmla="+- h 0 yC6" /><gd name="aD4" fmla="+- 9000000 ha 0" /><gd name="td41" fmla="cos rw aD4" /><gd name="td42" fmla="sin rh aD4" /><gd name="bD4" fmla="at2 td41 td42" /><gd name="xD4" fmla="+- w 0 xD1" /><gd name="xC4" fmla="+- w 0 xC1" /><gd name="xB4" fmla="+- w 0 xB1" /><gd name="aD5" fmla="+- 12600000 ha 0" /><gd name="td51" fmla="cos rw aD5" /><gd name="td52" fmla="sin rh aD5" /><gd name="bD5" fmla="at2 td51 td52" /><gd name="xD5" fmla="+- w 0 xA1" /><gd name="xC5" fmla="+- w 0 xB1" /><gd name="xB5" fmla="+- w 0 xC1" /><gd name="xCxn1" fmla="+/ xB1 xC1 2" /><gd name="yCxn1" fmla="+/ yB1 yC1 2" /><gd name="yCxn2" fmla="+- b 0 yCxn1" /><gd name="xCxn4" fmla="+/ r 0 xCxn1" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="20000"><pos x="xD6" y="yD6" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="5358"><pos x="xA6" y="yD6" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="19800000"><pos x="xCxn1" y="yCxn1" /></cxn><cxn ang="1800000"><pos x="xCxn1" y="yCxn2" /></cxn><cxn ang="cd4"><pos x="hc" y="yB3" /></cxn><cxn ang="9000000"><pos x="xCxn4" y="yCxn2" /></cxn><cxn ang="12600000"><pos x="xCxn4" y="yCxn1" /></cxn><cxn ang="3cd4"><pos x="hc" y="yC6" /></cxn></cxnLst><rect l="xD5" t="yA1" r="xA1" b="yD2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="xA1" y="yA1" /></moveTo><lnTo><pt x="xB1" y="yB1" /></lnTo><lnTo><pt x="xC1" y="yC1" /></lnTo><lnTo><pt x="xD1" y="yD1" /></lnTo><arcTo hR="rh" wR="rw" stAng="bD1" swAng="swAng2" /><lnTo><pt x="xC1" y="yB2" /></lnTo><lnTo><pt x="xB1" y="yC2" /></lnTo><lnTo><pt x="xA1" y="yD2" /></lnTo><arcTo hR="rh" wR="rw" stAng="bD2" swAng="swAng1" /><lnTo><pt x="xF6" y="yB3" /></lnTo><lnTo><pt x="xE6" y="yB3" /></lnTo><lnTo><pt x="xA6" y="yD3" /></lnTo><arcTo hR="rh" wR="rw" stAng="bD3" swAng="swAng1" /><lnTo><pt x="xB4" y="yC2" /></lnTo><lnTo><pt x="xC4" y="yB2" /></lnTo><lnTo><pt x="xD4" y="yA2" /></lnTo><arcTo hR="rh" wR="rw" stAng="bD4" swAng="swAng2" /><lnTo><pt x="xB5" y="yC1" /></lnTo><lnTo><pt x="xC5" y="yB1" /></lnTo><lnTo><pt x="xD5" y="yA1" /></lnTo><arcTo hR="rh" wR="rw" stAng="bD5" swAng="swAng1" /><lnTo><pt x="xE6" y="yC6" /></lnTo><lnTo><pt x="xF6" y="yC6" /></lnTo><lnTo><pt x="xD6" y="yD6" /></lnTo><arcTo hR="rh" wR="rw" stAng="bD6" swAng="swAng1" /><close /></path></pathLst>';
var Kt = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 10000" /><gd name="adj2" fmla="val 1763" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 20000" /><gd name="a2" fmla="pin 0 adj2 2679" /><gd name="th" fmla="*/ ss a1 100000" /><gd name="lFD" fmla="*/ ss a2 100000" /><gd name="th2" fmla="*/ th 1 2" /><gd name="l2" fmla="*/ lFD 1 2" /><gd name="l3" fmla="+- th2 l2 0" /><gd name="rh" fmla="+- hd2 0 th" /><gd name="rw" fmla="+- wd2 0 th" /><gd name="dr" fmla="+- rw 0 rh" /><gd name="maxr" fmla="?: dr rh rw" /><gd name="ha" fmla="at2 maxr l3" /><gd name="aA1" fmla="+- 18600000 0 ha" /><gd name="aD1" fmla="+- 18600000 ha 0" /><gd name="ta11" fmla="cos rw aA1" /><gd name="ta12" fmla="sin rh aA1" /><gd name="bA1" fmla="at2 ta11 ta12" /><gd name="cta1" fmla="cos rh bA1" /><gd name="sta1" fmla="sin rw bA1" /><gd name="ma1" fmla="mod cta1 sta1 0" /><gd name="na1" fmla="*/ rw rh ma1" /><gd name="dxa1" fmla="cos na1 bA1" /><gd name="dya1" fmla="sin na1 bA1" /><gd name="xA1" fmla="+- hc dxa1 0" /><gd name="yA1" fmla="+- vc dya1 0" /><gd name="td11" fmla="cos rw aD1" /><gd name="td12" fmla="sin rh aD1" /><gd name="bD1" fmla="at2 td11 td12" /><gd name="ctd1" fmla="cos rh bD1" /><gd name="std1" fmla="sin rw bD1" /><gd name="md1" fmla="mod ctd1 std1 0" /><gd name="nd1" fmla="*/ rw rh md1" /><gd name="dxd1" fmla="cos nd1 bD1" /><gd name="dyd1" fmla="sin nd1 bD1" /><gd name="xD1" fmla="+- hc dxd1 0" /><gd name="yD1" fmla="+- vc dyd1 0" /><gd name="xAD1" fmla="+- xA1 0 xD1" /><gd name="yAD1" fmla="+- yA1 0 yD1" /><gd name="lAD1" fmla="mod xAD1 yAD1 0" /><gd name="a12" fmla="at2 yAD1 xAD1" /><gd name="dxF1" fmla="sin lFD a12" /><gd name="dyF1" fmla="cos lFD a12" /><gd name="xF1" fmla="+- xD1 dxF1 0" /><gd name="yF1" fmla="+- yD1 dyF1 0" /><gd name="xE1" fmla="+- xA1 0 dxF1" /><gd name="yE1" fmla="+- yA1 0 dyF1" /><gd name="yC1t" fmla="sin th a12" /><gd name="xC1t" fmla="cos th a12" /><gd name="yC1" fmla="+- yF1 yC1t 0" /><gd name="xC1" fmla="+- xF1 0 xC1t" /><gd name="yB1" fmla="+- yE1 yC1t 0" /><gd name="xB1" fmla="+- xE1 0 xC1t" /><gd name="aA2" fmla="+- 21000000 0 ha" /><gd name="aD2" fmla="+- 21000000 ha 0" /><gd name="ta21" fmla="cos rw aA2" /><gd name="ta22" fmla="sin rh aA2" /><gd name="bA2" fmla="at2 ta21 ta22" /><gd name="cta2" fmla="cos rh bA2" /><gd name="sta2" fmla="sin rw bA2" /><gd name="ma2" fmla="mod cta2 sta2 0" /><gd name="na2" fmla="*/ rw rh ma2" /><gd name="dxa2" fmla="cos na2 bA2" /><gd name="dya2" fmla="sin na2 bA2" /><gd name="xA2" fmla="+- hc dxa2 0" /><gd name="yA2" fmla="+- vc dya2 0" /><gd name="td21" fmla="cos rw aD2" /><gd name="td22" fmla="sin rh aD2" /><gd name="bD2" fmla="at2 td21 td22" /><gd name="ctd2" fmla="cos rh bD2" /><gd name="std2" fmla="sin rw bD2" /><gd name="md2" fmla="mod ctd2 std2 0" /><gd name="nd2" fmla="*/ rw rh md2" /><gd name="dxd2" fmla="cos nd2 bD2" /><gd name="dyd2" fmla="sin nd2 bD2" /><gd name="xD2" fmla="+- hc dxd2 0" /><gd name="yD2" fmla="+- vc dyd2 0" /><gd name="xAD2" fmla="+- xA2 0 xD2" /><gd name="yAD2" fmla="+- yA2 0 yD2" /><gd name="lAD2" fmla="mod xAD2 yAD2 0" /><gd name="a22" fmla="at2 yAD2 xAD2" /><gd name="dxF2" fmla="sin lFD a22" /><gd name="dyF2" fmla="cos lFD a22" /><gd name="xF2" fmla="+- xD2 dxF2 0" /><gd name="yF2" fmla="+- yD2 dyF2 0" /><gd name="xE2" fmla="+- xA2 0 dxF2" /><gd name="yE2" fmla="+- yA2 0 dyF2" /><gd name="yC2t" fmla="sin th a22" /><gd name="xC2t" fmla="cos th a22" /><gd name="yC2" fmla="+- yF2 yC2t 0" /><gd name="xC2" fmla="+- xF2 0 xC2t" /><gd name="yB2" fmla="+- yE2 yC2t 0" /><gd name="xB2" fmla="+- xE2 0 xC2t" /><gd name="swAng1" fmla="+- bA2 0 bD1" /><gd name="aA3" fmla="+- 1800000 0 ha" /><gd name="aD3" fmla="+- 1800000 ha 0" /><gd name="ta31" fmla="cos rw aA3" /><gd name="ta32" fmla="sin rh aA3" /><gd name="bA3" fmla="at2 ta31 ta32" /><gd name="cta3" fmla="cos rh bA3" /><gd name="sta3" fmla="sin rw bA3" /><gd name="ma3" fmla="mod cta3 sta3 0" /><gd name="na3" fmla="*/ rw rh ma3" /><gd name="dxa3" fmla="cos na3 bA3" /><gd name="dya3" fmla="sin na3 bA3" /><gd name="xA3" fmla="+- hc dxa3 0" /><gd name="yA3" fmla="+- vc dya3 0" /><gd name="td31" fmla="cos rw aD3" /><gd name="td32" fmla="sin rh aD3" /><gd name="bD3" fmla="at2 td31 td32" /><gd name="ctd3" fmla="cos rh bD3" /><gd name="std3" fmla="sin rw bD3" /><gd name="md3" fmla="mod ctd3 std3 0" /><gd name="nd3" fmla="*/ rw rh md3" /><gd name="dxd3" fmla="cos nd3 bD3" /><gd name="dyd3" fmla="sin nd3 bD3" /><gd name="xD3" fmla="+- hc dxd3 0" /><gd name="yD3" fmla="+- vc dyd3 0" /><gd name="xAD3" fmla="+- xA3 0 xD3" /><gd name="yAD3" fmla="+- yA3 0 yD3" /><gd name="lAD3" fmla="mod xAD3 yAD3 0" /><gd name="a3" fmla="at2 yAD3 xAD3" /><gd name="dxF3" fmla="sin lFD a3" /><gd name="dyF3" fmla="cos lFD a3" /><gd name="xF3" fmla="+- xD3 dxF3 0" /><gd name="yF3" fmla="+- yD3 dyF3 0" /><gd name="xE3" fmla="+- xA3 0 dxF3" /><gd name="yE3" fmla="+- yA3 0 dyF3" /><gd name="yC3t" fmla="sin th a3" /><gd name="xC3t" fmla="cos th a3" /><gd name="yC3" fmla="+- yF3 yC3t 0" /><gd name="xC3" fmla="+- xF3 0 xC3t" /><gd name="yB3" fmla="+- yE3 yC3t 0" /><gd name="xB3" fmla="+- xE3 0 xC3t" /><gd name="swAng2" fmla="+- bA3 0 bD2" /><gd name="aA4" fmla="+- 4200000 0 ha" /><gd name="aD4" fmla="+- 4200000 ha 0" /><gd name="ta41" fmla="cos rw aA4" /><gd name="ta42" fmla="sin rh aA4" /><gd name="bA4" fmla="at2 ta41 ta42" /><gd name="cta4" fmla="cos rh bA4" /><gd name="sta4" fmla="sin rw bA4" /><gd name="ma4" fmla="mod cta4 sta4 0" /><gd name="na4" fmla="*/ rw rh ma4" /><gd name="dxa4" fmla="cos na4 bA4" /><gd name="dya4" fmla="sin na4 bA4" /><gd name="xA4" fmla="+- hc dxa4 0" /><gd name="yA4" fmla="+- vc dya4 0" /><gd name="td41" fmla="cos rw aD4" /><gd name="td42" fmla="sin rh aD4" /><gd name="bD4" fmla="at2 td41 td42" /><gd name="ctd4" fmla="cos rh bD4" /><gd name="std4" fmla="sin rw bD4" /><gd name="md4" fmla="mod ctd4 std4 0" /><gd name="nd4" fmla="*/ rw rh md4" /><gd name="dxd4" fmla="cos nd4 bD4" /><gd name="dyd4" fmla="sin nd4 bD4" /><gd name="xD4" fmla="+- hc dxd4 0" /><gd name="yD4" fmla="+- vc dyd4 0" /><gd name="xAD4" fmla="+- xA4 0 xD4" /><gd name="yAD4" fmla="+- yA4 0 yD4" /><gd name="lAD4" fmla="mod xAD4 yAD4 0" /><gd name="a4" fmla="at2 yAD4 xAD4" /><gd name="dxF4" fmla="sin lFD a4" /><gd name="dyF4" fmla="cos lFD a4" /><gd name="xF4" fmla="+- xD4 dxF4 0" /><gd name="yF4" fmla="+- yD4 dyF4 0" /><gd name="xE4" fmla="+- xA4 0 dxF4" /><gd name="yE4" fmla="+- yA4 0 dyF4" /><gd name="yC4t" fmla="sin th a4" /><gd name="xC4t" fmla="cos th a4" /><gd name="yC4" fmla="+- yF4 yC4t 0" /><gd name="xC4" fmla="+- xF4 0 xC4t" /><gd name="yB4" fmla="+- yE4 yC4t 0" /><gd name="xB4" fmla="+- xE4 0 xC4t" /><gd name="swAng3" fmla="+- bA4 0 bD3" /><gd name="aA5" fmla="+- 6600000 0 ha" /><gd name="aD5" fmla="+- 6600000 ha 0" /><gd name="ta51" fmla="cos rw aA5" /><gd name="ta52" fmla="sin rh aA5" /><gd name="bA5" fmla="at2 ta51 ta52" /><gd name="td51" fmla="cos rw aD5" /><gd name="td52" fmla="sin rh aD5" /><gd name="bD5" fmla="at2 td51 td52" /><gd name="xD5" fmla="+- w 0 xA4" /><gd name="xC5" fmla="+- w 0 xB4" /><gd name="xB5" fmla="+- w 0 xC4" /><gd name="swAng4" fmla="+- bA5 0 bD4" /><gd name="aD6" fmla="+- 9000000 ha 0" /><gd name="td61" fmla="cos rw aD6" /><gd name="td62" fmla="sin rh aD6" /><gd name="bD6" fmla="at2 td61 td62" /><gd name="xD6" fmla="+- w 0 xA3" /><gd name="xC6" fmla="+- w 0 xB3" /><gd name="xB6" fmla="+- w 0 xC3" /><gd name="aD7" fmla="+- 11400000 ha 0" /><gd name="td71" fmla="cos rw aD7" /><gd name="td72" fmla="sin rh aD7" /><gd name="bD7" fmla="at2 td71 td72" /><gd name="xD7" fmla="+- w 0 xA2" /><gd name="xC7" fmla="+- w 0 xB2" /><gd name="xB7" fmla="+- w 0 xC2" /><gd name="aD8" fmla="+- 13800000 ha 0" /><gd name="td81" fmla="cos rw aD8" /><gd name="td82" fmla="sin rh aD8" /><gd name="bD8" fmla="at2 td81 td82" /><gd name="xA8" fmla="+- w 0 xD1" /><gd name="xD8" fmla="+- w 0 xA1" /><gd name="xC8" fmla="+- w 0 xB1" /><gd name="xB8" fmla="+- w 0 xC1" /><gd name="aA9" fmla="+- 3cd4 0 ha" /><gd name="aD9" fmla="+- 3cd4 ha 0" /><gd name="td91" fmla="cos rw aD9" /><gd name="td92" fmla="sin rh aD9" /><gd name="bD9" fmla="at2 td91 td92" /><gd name="ctd9" fmla="cos rh bD9" /><gd name="std9" fmla="sin rw bD9" /><gd name="md9" fmla="mod ctd9 std9 0" /><gd name="nd9" fmla="*/ rw rh md9" /><gd name="dxd9" fmla="cos nd9 bD9" /><gd name="dyd9" fmla="sin nd9 bD9" /><gd name="xD9" fmla="+- hc dxd9 0" /><gd name="yD9" fmla="+- vc dyd9 0" /><gd name="ta91" fmla="cos rw aA9" /><gd name="ta92" fmla="sin rh aA9" /><gd name="bA9" fmla="at2 ta91 ta92" /><gd name="xA9" fmla="+- hc 0 dxd9" /><gd name="xF9" fmla="+- xD9 0 lFD" /><gd name="xE9" fmla="+- xA9 lFD 0" /><gd name="yC9" fmla="+- yD9 0 th" /><gd name="swAng5" fmla="+- bA9 0 bD8" /><gd name="xCxn1" fmla="+/ xB1 xC1 2" /><gd name="yCxn1" fmla="+/ yB1 yC1 2" /><gd name="xCxn2" fmla="+/ xB2 xC2 2" /><gd name="yCxn2" fmla="+/ yB2 yC2 2" /><gd name="xCxn3" fmla="+/ xB3 xC3 2" /><gd name="yCxn3" fmla="+/ yB3 yC3 2" /><gd name="xCxn4" fmla="+/ xB4 xC4 2" /><gd name="yCxn4" fmla="+/ yB4 yC4 2" /><gd name="xCxn5" fmla="+/ r 0 xCxn4" /><gd name="xCxn6" fmla="+/ r 0 xCxn3" /><gd name="xCxn7" fmla="+/ r 0 xCxn2" /><gd name="xCxn8" fmla="+/ r 0 xCxn1" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="20000"><pos x="xD9" y="yD9" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="2679"><pos x="xA9" y="yD9" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="18600000"><pos x="xCxn1" y="yCxn1" /></cxn><cxn ang="21000000"><pos x="xCxn2" y="yCxn2" /></cxn><cxn ang="1800000"><pos x="xCxn3" y="yCxn3" /></cxn><cxn ang="4200000"><pos x="xCxn4" y="yCxn4" /></cxn><cxn ang="6600000"><pos x="xCxn5" y="yCxn4" /></cxn><cxn ang="9000000"><pos x="xCxn6" y="yCxn3" /></cxn><cxn ang="11400000"><pos x="xCxn7" y="yCxn2" /></cxn><cxn ang="13800000"><pos x="xCxn8" y="yCxn1" /></cxn><cxn ang="3cd4"><pos x="hc" y="yC9" /></cxn></cxnLst><rect l="xA8" t="yD1" r="xD1" b="yD3" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="xA1" y="yA1" /></moveTo><lnTo><pt x="xB1" y="yB1" /></lnTo><lnTo><pt x="xC1" y="yC1" /></lnTo><lnTo><pt x="xD1" y="yD1" /></lnTo><arcTo hR="rh" wR="rw" stAng="bD1" swAng="swAng1" /><lnTo><pt x="xB2" y="yB2" /></lnTo><lnTo><pt x="xC2" y="yC2" /></lnTo><lnTo><pt x="xD2" y="yD2" /></lnTo><arcTo hR="rh" wR="rw" stAng="bD2" swAng="swAng2" /><lnTo><pt x="xB3" y="yB3" /></lnTo><lnTo><pt x="xC3" y="yC3" /></lnTo><lnTo><pt x="xD3" y="yD3" /></lnTo><arcTo hR="rh" wR="rw" stAng="bD3" swAng="swAng3" /><lnTo><pt x="xB4" y="yB4" /></lnTo><lnTo><pt x="xC4" y="yC4" /></lnTo><lnTo><pt x="xD4" y="yD4" /></lnTo><arcTo hR="rh" wR="rw" stAng="bD4" swAng="swAng4" /><lnTo><pt x="xB5" y="yC4" /></lnTo><lnTo><pt x="xC5" y="yB4" /></lnTo><lnTo><pt x="xD5" y="yA4" /></lnTo><arcTo hR="rh" wR="rw" stAng="bD5" swAng="swAng3" /><lnTo><pt x="xB6" y="yC3" /></lnTo><lnTo><pt x="xC6" y="yB3" /></lnTo><lnTo><pt x="xD6" y="yA3" /></lnTo><arcTo hR="rh" wR="rw" stAng="bD6" swAng="swAng2" /><lnTo><pt x="xB7" y="yC2" /></lnTo><lnTo><pt x="xC7" y="yB2" /></lnTo><lnTo><pt x="xD7" y="yA2" /></lnTo><arcTo hR="rh" wR="rw" stAng="bD7" swAng="swAng1" /><lnTo><pt x="xB8" y="yC1" /></lnTo><lnTo><pt x="xC8" y="yB1" /></lnTo><lnTo><pt x="xD8" y="yA1" /></lnTo><arcTo hR="rh" wR="rw" stAng="bD8" swAng="swAng5" /><lnTo><pt x="xE9" y="yC9" /></lnTo><lnTo><pt x="xF9" y="yC9" /></lnTo><lnTo><pt x="xD9" y="yD9" /></lnTo><arcTo hR="rh" wR="rw" stAng="bD9" swAng="swAng5" /><close /></path></pathLst>';
var Jt = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 33333" /><gd name="adj2" fmla="val 33333" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 100000 w ss" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="x1" fmla="*/ ss a2 100000" /><gd name="g1" fmla="*/ h x1 w" /><gd name="g2" fmla="+- h 0 g1" /><gd name="maxAdj1" fmla="*/ 100000 g2 ss" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="y1" fmla="*/ ss a1 100000" /><gd name="dx2" fmla="*/ y1 w h" /><gd name="x2" fmla="+- r 0 dx2" /><gd name="dy2" fmla="*/ x1 h w" /><gd name="y2" fmla="+- b 0 dy2" /><gd name="cx1" fmla="*/ x1 1 2" /><gd name="cy1" fmla="+/ y2 b 2" /><gd name="cx2" fmla="+/ x2 r 2" /><gd name="cy2" fmla="*/ y1 1 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="maxAdj1"><pos x="l" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="maxAdj2"><pos x="x1" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="cx2" y="cy2" /></cxn><cxn ang="cd4"><pos x="cx1" y="cy1" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="x1" y="y1" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var ao = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="dx1" fmla="*/ w 49 48" /><gd name="dx2" fmla="*/ w 10 48" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- hc dx2 0" /><gd name="x4" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- t 0 hd3" /><gd name="il" fmla="*/ w 1 6" /><gd name="ir" fmla="*/ w 5 6" /><gd name="ib" fmla="*/ h 2 3" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="hd4" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn></cxnLst><rect l="il" t="hd4" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="hc" y="hd4" /></moveTo><cubicBezTo><pt x="x3" y="y1" /><pt x="x4" y="hd4" /><pt x="hc" y="b" /></cubicBezTo><cubicBezTo><pt x="x1" y="hd4" /><pt x="x2" y="y1" /><pt x="hc" y="hd4" /></cubicBezTo><close /></path></pathLst>';
var no = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="hf" fmla="val 102572" /><gd name="vf" fmla="val 105210" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="swd2" fmla="*/ wd2 hf 100000" /><gd name="shd2" fmla="*/ hd2 vf 100000" /><gd name="svc" fmla="*/ vc  vf 100000" /><gd name="dx1" fmla="*/ swd2 97493 100000" /><gd name="dx2" fmla="*/ swd2 78183 100000" /><gd name="dx3" fmla="*/ swd2 43388 100000" /><gd name="dy1" fmla="*/ shd2 62349 100000" /><gd name="dy2" fmla="*/ shd2 22252 100000" /><gd name="dy3" fmla="*/ shd2 90097 100000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- hc 0 dx3" /><gd name="x4" fmla="+- hc dx3 0" /><gd name="x5" fmla="+- hc dx2 0" /><gd name="x6" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- svc 0 dy1" /><gd name="y2" fmla="+- svc dy2 0" /><gd name="y3" fmla="+- svc dy3 0" /><gd name="ib" fmla="+- b 0 y1" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="x5" y="y1" /></cxn><cxn ang="0"><pos x="x6" y="y2" /></cxn><cxn ang="cd4"><pos x="x4" y="y3" /></cxn><cxn ang="cd4"><pos x="x3" y="y3" /></cxn><cxn ang="cd2"><pos x="x1" y="y2" /></cxn><cxn ang="cd2"><pos x="x2" y="y1" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="x2" t="y1" r="x5" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y2" /></moveTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="x5" y="y1" /></lnTo><lnTo><pt x="x6" y="y2" /></lnTo><lnTo><pt x="x4" y="y3" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo><close /></path></pathLst>';
var mo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 25000" /><gd name="vf" fmla="val 115470" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj" fmla="*/ 50000 w ss" /><gd name="a" fmla="pin 0 adj maxAdj" /><gd name="shd2" fmla="*/ hd2 vf 100000" /><gd name="x1" fmla="*/ ss a 100000" /><gd name="x2" fmla="+- r 0 x1" /><gd name="dy1" fmla="sin shd2 3600000" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y2" fmla="+- vc dy1 0" /><gd name="q1" fmla="*/ maxAdj -1 2" /><gd name="q2" fmla="+- a q1 0" /><gd name="q3" fmla="?: q2 4 2" /><gd name="q4" fmla="?: q2 3 2" /><gd name="q5" fmla="?: q2 q1 0" /><gd name="q6" fmla="+/ a q5 q1" /><gd name="q7" fmla="*/ q6 q4 -1" /><gd name="q8" fmla="+- q3 q7 0" /><gd name="il" fmla="*/ w q8 24" /><gd name="it" fmla="*/ h q8 24" /><gd name="ir" fmla="+- r 0 il" /><gd name="ib" fmla="+- b 0 it" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="maxAdj"><pos x="x1" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="x2" y="y2" /></cxn><cxn ang="cd4"><pos x="x1" y="y2" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="x1" y="y1" /></cxn><cxn ang="3cd4"><pos x="x2" y="y1" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="x1" y="y1" /></lnTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><close /></path></pathLst>';
var to = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj" fmla="*/ 100000 w ss" /><gd name="a" fmla="pin 0 adj maxAdj" /><gd name="dx1" fmla="*/ ss a 100000" /><gd name="x1" fmla="+- r 0 dx1" /><gd name="ir" fmla="+/ x1 r 2" /><gd name="x2" fmla="*/ x1 1 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="maxAdj"><pos x="x1" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x2" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="x1" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="t" r="ir" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="x1" y="t" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="x1" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var oo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 12500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 25000" /><gd name="ch" fmla="*/ ss a 100000" /><gd name="ch2" fmla="*/ ch 1 2" /><gd name="ch4" fmla="*/ ch 1 4" /><gd name="y3" fmla="+- ch ch2 0" /><gd name="y4" fmla="+- ch ch 0" /><gd name="y6" fmla="+- b 0 ch" /><gd name="y7" fmla="+- b 0 ch2" /><gd name="y5" fmla="+- y6 0 ch2" /><gd name="x3" fmla="+- r 0 ch" /><gd name="x4" fmla="+- r 0 ch2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="25000"><pos x="ch" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd4"><pos x="hc" y="ch" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="y6" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="ch" t="ch" r="x4" b="y6" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="r" y="ch2" /></moveTo><arcTo wR="ch2" hR="ch2" stAng="0" swAng="cd4" /><lnTo><pt x="x4" y="ch2" /></lnTo><arcTo wR="ch4" hR="ch4" stAng="0" swAng="cd2" /><lnTo><pt x="x3" y="ch" /></lnTo><lnTo><pt x="ch2" y="ch" /></lnTo><arcTo wR="ch2" hR="ch2" stAng="3cd4" swAng="-5400000" /><lnTo><pt x="l" y="y7" /></lnTo><arcTo wR="ch2" hR="ch2" stAng="cd2" swAng="-10800000" /><lnTo><pt x="ch" y="y6" /></lnTo><lnTo><pt x="x4" y="y6" /></lnTo><arcTo wR="ch2" hR="ch2" stAng="cd4" swAng="-5400000" /><close /><moveTo><pt x="ch2" y="y4" /></moveTo><arcTo wR="ch2" hR="ch2" stAng="cd4" swAng="-5400000" /><arcTo wR="ch4" hR="ch4" stAng="0" swAng="-10800000" /><close /></path><path fill="darkenLess" stroke="false" extrusionOk="false"><moveTo><pt x="ch2" y="y4" /></moveTo><arcTo wR="ch2" hR="ch2" stAng="cd4" swAng="-5400000" /><arcTo wR="ch4" hR="ch4" stAng="0" swAng="-10800000" /><close /><moveTo><pt x="x4" y="ch" /></moveTo><arcTo wR="ch2" hR="ch2" stAng="cd4" swAng="-16200000" /><arcTo wR="ch4" hR="ch4" stAng="cd2" swAng="-10800000" /><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="l" y="y3" /></moveTo><arcTo wR="ch2" hR="ch2" stAng="cd2" swAng="cd4" /><lnTo><pt x="x3" y="ch" /></lnTo><lnTo><pt x="x3" y="ch2" /></lnTo><arcTo wR="ch2" hR="ch2" stAng="cd2" swAng="cd2" /><lnTo><pt x="r" y="y5" /></lnTo><arcTo wR="ch2" hR="ch2" stAng="0" swAng="cd4" /><lnTo><pt x="ch" y="y6" /></lnTo><lnTo><pt x="ch" y="y7" /></lnTo><arcTo wR="ch2" hR="ch2" stAng="0" swAng="cd2" /><close /><moveTo><pt x="x3" y="ch" /></moveTo><lnTo><pt x="x4" y="ch" /></lnTo><arcTo wR="ch2" hR="ch2" stAng="cd4" swAng="-5400000" /><moveTo><pt x="x4" y="ch" /></moveTo><lnTo><pt x="x4" y="ch2" /></lnTo><arcTo wR="ch4" hR="ch4" stAng="0" swAng="cd2" /><moveTo><pt x="ch2" y="y4" /></moveTo><lnTo><pt x="ch2" y="y3" /></lnTo><arcTo wR="ch4" hR="ch4" stAng="cd2" swAng="cd2" /><arcTo wR="ch2" hR="ch2" stAng="0" swAng="cd2" /><moveTo><pt x="ch" y="y3" /></moveTo><lnTo><pt x="ch" y="y6" /></lnTo></path></pathLst>';
var lo = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x5" fmla="*/ w 4627 21600" /><gd name="x12" fmla="*/ w 8485 21600" /><gd name="x21" fmla="*/ w 16702 21600" /><gd name="x24" fmla="*/ w 14522 21600" /><gd name="y3" fmla="*/ h 6320 21600" /><gd name="y6" fmla="*/ h 8615 21600" /><gd name="y9" fmla="*/ h 13937 21600" /><gd name="y18" fmla="*/ h 13290 21600" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x24" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="y6" /></cxn><cxn ang="cd4"><pos x="x12" y="b" /></cxn><cxn ang="0"><pos x="r" y="y18" /></cxn></cxnLst><rect l="x5" t="y3" r="x21" b="y9" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="21600" h="21600"><moveTo><pt x="10800" y="5800" /></moveTo><lnTo><pt x="14522" y="0" /></lnTo><lnTo><pt x="14155" y="5325" /></lnTo><lnTo><pt x="18380" y="4457" /></lnTo><lnTo><pt x="16702" y="7315" /></lnTo><lnTo><pt x="21097" y="8137" /></lnTo><lnTo><pt x="17607" y="10475" /></lnTo><lnTo><pt x="21600" y="13290" /></lnTo><lnTo><pt x="16837" y="12942" /></lnTo><lnTo><pt x="18145" y="18095" /></lnTo><lnTo><pt x="14020" y="14457" /></lnTo><lnTo><pt x="13247" y="19737" /></lnTo><lnTo><pt x="10532" y="14935" /></lnTo><lnTo><pt x="8485" y="21600" /></lnTo><lnTo><pt x="7715" y="15627" /></lnTo><lnTo><pt x="4762" y="17617" /></lnTo><lnTo><pt x="5667" y="13937" /></lnTo><lnTo><pt x="135" y="14587" /></lnTo><lnTo><pt x="3722" y="11775" /></lnTo><lnTo><pt x="0" y="8615" /></lnTo><lnTo><pt x="4627" y="7617" /></lnTo><lnTo><pt x="370" y="2295" /></lnTo><lnTo><pt x="7312" y="6320" /></lnTo><lnTo><pt x="8352" y="2295" /></lnTo><close /></path></pathLst>';
var so = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x2" fmla="*/ w 9722 21600" /><gd name="x5" fmla="*/ w 5372 21600" /><gd name="x16" fmla="*/ w 11612 21600" /><gd name="x19" fmla="*/ w 14640 21600" /><gd name="y2" fmla="*/ h 1887 21600" /><gd name="y3" fmla="*/ h 6382 21600" /><gd name="y8" fmla="*/ h 12877 21600" /><gd name="y14" fmla="*/ h 19712 21600" /><gd name="y16" fmla="*/ h 18842 21600" /><gd name="y17" fmla="*/ h 15935 21600" /><gd name="y24" fmla="*/ h 6645 21600" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x2" y="y2" /></cxn><cxn ang="cd2"><pos x="l" y="y8" /></cxn><cxn ang="cd4"><pos x="x16" y="y16" /></cxn><cxn ang="0"><pos x="r" y="y24" /></cxn></cxnLst><rect l="x5" t="y3" r="x19" b="y17" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="21600" h="21600"><moveTo><pt x="11462" y="4342" /></moveTo><lnTo><pt x="14790" y="0" /></lnTo><lnTo><pt x="14525" y="5777" /></lnTo><lnTo><pt x="18007" y="3172" /></lnTo><lnTo><pt x="16380" y="6532" /></lnTo><lnTo><pt x="21600" y="6645" /></lnTo><lnTo><pt x="16985" y="9402" /></lnTo><lnTo><pt x="18270" y="11290" /></lnTo><lnTo><pt x="16380" y="12310" /></lnTo><lnTo><pt x="18877" y="15632" /></lnTo><lnTo><pt x="14640" y="14350" /></lnTo><lnTo><pt x="14942" y="17370" /></lnTo><lnTo><pt x="12180" y="15935" /></lnTo><lnTo><pt x="11612" y="18842" /></lnTo><lnTo><pt x="9872" y="17370" /></lnTo><lnTo><pt x="8700" y="19712" /></lnTo><lnTo><pt x="7527" y="18125" /></lnTo><lnTo><pt x="4917" y="21600" /></lnTo><lnTo><pt x="4805" y="18240" /></lnTo><lnTo><pt x="1285" y="17825" /></lnTo><lnTo><pt x="3330" y="15370" /></lnTo><lnTo><pt x="0" y="12877" /></lnTo><lnTo><pt x="3935" y="11592" /></lnTo><lnTo><pt x="1172" y="8270" /></lnTo><lnTo><pt x="5372" y="7817" /></lnTo><lnTo><pt x="4502" y="3625" /></lnTo><lnTo><pt x="8550" y="6382" /></lnTo><lnTo><pt x="9722" y="1887" /></lnTo><close /></path></pathLst>';
var eo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 50000" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 100000 w ss" /><gd name="a1" fmla="pin 0 adj1 100000" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="dx2" fmla="*/ ss a2 100000" /><gd name="x2" fmla="+- l dx2 0" /><gd name="dy1" fmla="*/ h a1 200000" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y2" fmla="+- vc dy1 0" /><gd name="dx1" fmla="*/ y1 dx2 hd2" /><gd name="x1" fmla="+- x2  0 dx1" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="100000"><pos x="r" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="maxAdj2"><pos x="x2" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x2" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="x2" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="x1" t="y1" r="r" b="y2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="r" y="y1" /></lnTo><lnTo><pt x="r" y="y2" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x2" y="b" /></lnTo><close /></path></pathLst>';
var xo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 25000" /><gd name="adj3" fmla="val 25000" /><gd name="adj4" fmla="val 64977" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 50000 h ss" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="maxAdj1" fmla="*/ a2 2 1" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="maxAdj3" fmla="*/ 100000 w ss" /><gd name="a3" fmla="pin 0 adj3 maxAdj3" /><gd name="q2" fmla="*/ a3 ss w" /><gd name="maxAdj4" fmla="+- 100000 0 q2" /><gd name="a4" fmla="pin 0 adj4 maxAdj4" /><gd name="dy1" fmla="*/ ss a2 100000" /><gd name="dy2" fmla="*/ ss a1 200000" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y2" fmla="+- vc 0 dy2" /><gd name="y3" fmla="+- vc dy2 0" /><gd name="y4" fmla="+- vc dy1 0" /><gd name="x1" fmla="*/ ss a3 100000" /><gd name="dx2" fmla="*/ w a4 100000" /><gd name="x2" fmla="+- r 0 dx2" /><gd name="x3" fmla="+/ x2 r 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="maxAdj1"><pos x="x1" y="y2" /></ahXY><ahXY gdRefY="adj2" minY="0" maxY="maxAdj2"><pos x="l" y="y1" /></ahXY><ahXY gdRefX="adj3" minX="0" maxX="maxAdj3"><pos x="x1" y="t" /></ahXY><ahXY gdRefX="adj4" minX="0" maxX="maxAdj4"><pos x="x2" y="b" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x3" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="x3" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="x2" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="x1" y="y1" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="x2" y="b" /></lnTo><lnTo><pt x="x2" y="y3" /></lnTo><lnTo><pt x="x1" y="y3" /></lnTo><lnTo><pt x="x1" y="y4" /></lnTo><close /></path></pathLst>';
var go = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 8333" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a2" fmla="pin 0 adj2 100000" /><gd name="q1" fmla="+- 100000 0 a2" /><gd name="q2" fmla="min q1 a2" /><gd name="q3" fmla="*/ q2 1 2" /><gd name="maxAdj1" fmla="*/ q3 h ss" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="y1" fmla="*/ ss a1 100000" /><gd name="y3" fmla="*/ h a2 100000" /><gd name="y4" fmla="+- y3 y1 0" /><gd name="dx1" fmla="cos wd2 2700000" /><gd name="dy1" fmla="sin y1 2700000" /><gd name="il" fmla="+- r 0 dx1" /><gd name="it" fmla="+- y1 0 dy1" /><gd name="ib" fmla="+- b dy1 y1" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="maxAdj1"><pos x="hc" y="y1" /></ahXY><ahXY gdRefY="adj2" minY="0" maxY="100000"><pos x="l" y="y3" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd4"><pos x="r" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="y3" /></cxn><cxn ang="3cd4"><pos x="r" y="b" /></cxn></cxnLst><rect l="il" t="it" r="r" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="r" y="b" /></moveTo><arcTo wR="wd2" hR="y1" stAng="cd4" swAng="cd4" /><lnTo><pt x="hc" y="y4" /></lnTo><arcTo wR="wd2" hR="y1" stAng="0" swAng="-5400000" /><arcTo wR="wd2" hR="y1" stAng="cd4" swAng="-5400000" /><lnTo><pt x="hc" y="y1" /></lnTo><arcTo wR="wd2" hR="y1" stAng="cd2" swAng="cd4" /><close /></path><path fill="none"><moveTo><pt x="r" y="b" /></moveTo><arcTo wR="wd2" hR="y1" stAng="cd4" swAng="cd4" /><lnTo><pt x="hc" y="y4" /></lnTo><arcTo wR="wd2" hR="y1" stAng="0" swAng="-5400000" /><arcTo wR="wd2" hR="y1" stAng="cd4" swAng="-5400000" /><lnTo><pt x="hc" y="y1" /></lnTo><arcTo wR="wd2" hR="y1" stAng="cd2" swAng="cd4" /></path></pathLst>';
var co = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 8333" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj" fmla="*/ 50000 h ss" /><gd name="a" fmla="pin 0 adj maxAdj" /><gd name="y1" fmla="*/ ss a 100000" /><gd name="y2" fmla="+- b 0 y1" /><gd name="dx1" fmla="cos w 2700000" /><gd name="dy1" fmla="sin y1 2700000" /><gd name="il" fmla="+- r 0 dx1" /><gd name="it" fmla="+- y1 0 dy1" /><gd name="ib" fmla="+- b dy1 y1" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="maxAdj"><pos x="l" y="y1" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd4"><pos x="r" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="r" y="b" /></cxn></cxnLst><rect l="il" t="it" r="r" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="r" y="b" /></moveTo><arcTo wR="w" hR="y1" stAng="cd4" swAng="cd4" /><lnTo><pt x="l" y="y1" /></lnTo><arcTo wR="w" hR="y1" stAng="cd2" swAng="cd4" /><close /></path><path fill="none"><moveTo><pt x="r" y="b" /></moveTo><arcTo wR="w" hR="y1" stAng="cd4" swAng="cd4" /><lnTo><pt x="l" y="y1" /></lnTo><arcTo wR="w" hR="y1" stAng="cd2" swAng="cd4" /></path></pathLst>';
var ro = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 12500" /><gd name="adj2" fmla="val -1142319" /><gd name="adj3" fmla="val 1142319" /><gd name="adj4" fmla="val 10800000" /><gd name="adj5" fmla="val 12500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a5" fmla="pin 0 adj5 25000" /><gd name="maxAdj1" fmla="*/ a5 2 1" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="enAng" fmla="pin 1 adj3 21599999" /><gd name="stAng" fmla="pin 0 adj4 21599999" /><gd name="th" fmla="*/ ss a1 100000" /><gd name="thh" fmla="*/ ss a5 100000" /><gd name="th2" fmla="*/ th 1 2" /><gd name="rw1" fmla="+- wd2 th2 thh" /><gd name="rh1" fmla="+- hd2 th2 thh" /><gd name="rw2" fmla="+- rw1 0 th" /><gd name="rh2" fmla="+- rh1 0 th" /><gd name="rw3" fmla="+- rw2 th2 0" /><gd name="rh3" fmla="+- rh2 th2 0" /><gd name="wtH" fmla="sin rw3 enAng" /><gd name="htH" fmla="cos rh3 enAng" /><gd name="dxH" fmla="cat2 rw3 htH wtH" /><gd name="dyH" fmla="sat2 rh3 htH wtH" /><gd name="xH" fmla="+- hc dxH 0" /><gd name="yH" fmla="+- vc dyH 0" /><gd name="rI" fmla="min rw2 rh2" /><gd name="u1" fmla="*/ dxH dxH 1" /><gd name="u2" fmla="*/ dyH dyH 1" /><gd name="u3" fmla="*/ rI rI 1" /><gd name="u4" fmla="+- u1 0 u3" /><gd name="u5" fmla="+- u2 0 u3" /><gd name="u6" fmla="*/ u4 u5 u1" /><gd name="u7" fmla="*/ u6 1 u2" /><gd name="u8" fmla="+- 1 0 u7" /><gd name="u9" fmla="sqrt u8" /><gd name="u10" fmla="*/ u4 1 dxH" /><gd name="u11" fmla="*/ u10 1 dyH" /><gd name="u12" fmla="+/ 1 u9 u11" /><gd name="u13" fmla="at2 1 u12" /><gd name="u14" fmla="+- u13 21600000 0" /><gd name="u15" fmla="?: u13 u13 u14" /><gd name="u16" fmla="+- u15 0 enAng" /><gd name="u17" fmla="+- u16 21600000 0" /><gd name="u18" fmla="?: u16 u16 u17" /><gd name="u19" fmla="+- u18 0 cd2" /><gd name="u20" fmla="+- u18 0 21600000" /><gd name="u21" fmla="?: u19 u20 u18" /><gd name="u22" fmla="abs u21" /><gd name="minAng" fmla="*/ u22 -1 1" /><gd name="u23" fmla="abs adj2" /><gd name="a2" fmla="*/ u23 -1 1" /><gd name="aAng" fmla="pin minAng a2 0" /><gd name="ptAng" fmla="+- enAng aAng 0" /><gd name="wtA" fmla="sin rw3 ptAng" /><gd name="htA" fmla="cos rh3 ptAng" /><gd name="dxA" fmla="cat2 rw3 htA wtA" /><gd name="dyA" fmla="sat2 rh3 htA wtA" /><gd name="xA" fmla="+- hc dxA 0" /><gd name="yA" fmla="+- vc dyA 0" /><gd name="wtE" fmla="sin rw1 stAng" /><gd name="htE" fmla="cos rh1 stAng" /><gd name="dxE" fmla="cat2 rw1 htE wtE" /><gd name="dyE" fmla="sat2 rh1 htE wtE" /><gd name="xE" fmla="+- hc dxE 0" /><gd name="yE" fmla="+- vc dyE 0" /><gd name="wtD" fmla="sin rw2 stAng" /><gd name="htD" fmla="cos rh2 stAng" /><gd name="dxD" fmla="cat2 rw2 htD wtD" /><gd name="dyD" fmla="sat2 rh2 htD wtD" /><gd name="xD" fmla="+- hc dxD 0" /><gd name="yD" fmla="+- vc dyD 0" /><gd name="dxG" fmla="cos thh ptAng" /><gd name="dyG" fmla="sin thh ptAng" /><gd name="xG" fmla="+- xH dxG 0" /><gd name="yG" fmla="+- yH dyG 0" /><gd name="dxB" fmla="cos thh ptAng" /><gd name="dyB" fmla="sin thh ptAng" /><gd name="xB" fmla="+- xH 0 dxB 0" /><gd name="yB" fmla="+- yH 0 dyB 0" /><gd name="sx1" fmla="+- xB 0 hc" /><gd name="sy1" fmla="+- yB 0 vc" /><gd name="sx2" fmla="+- xG 0 hc" /><gd name="sy2" fmla="+- yG 0 vc" /><gd name="rO" fmla="min rw1 rh1" /><gd name="x1O" fmla="*/ sx1 rO rw1" /><gd name="y1O" fmla="*/ sy1 rO rh1" /><gd name="x2O" fmla="*/ sx2 rO rw1" /><gd name="y2O" fmla="*/ sy2 rO rh1" /><gd name="dxO" fmla="+- x2O 0 x1O" /><gd name="dyO" fmla="+- y2O 0 y1O" /><gd name="dO" fmla="mod dxO dyO 0" /><gd name="q1" fmla="*/ x1O y2O 1" /><gd name="q2" fmla="*/ x2O y1O 1" /><gd name="DO" fmla="+- q1 0 q2" /><gd name="q3" fmla="*/ rO rO 1" /><gd name="q4" fmla="*/ dO dO 1" /><gd name="q5" fmla="*/ q3 q4 1" /><gd name="q6" fmla="*/ DO DO 1" /><gd name="q7" fmla="+- q5 0 q6" /><gd name="q8" fmla="max q7 0" /><gd name="sdelO" fmla="sqrt q8" /><gd name="ndyO" fmla="*/ dyO -1 1" /><gd name="sdyO" fmla="?: ndyO -1 1" /><gd name="q9" fmla="*/ sdyO dxO 1" /><gd name="q10" fmla="*/ q9 sdelO 1" /><gd name="q11" fmla="*/ DO dyO 1" /><gd name="dxF1" fmla="+/ q11 q10 q4" /><gd name="q12" fmla="+- q11 0 q10" /><gd name="dxF2" fmla="*/ q12 1 q4" /><gd name="adyO" fmla="abs dyO" /><gd name="q13" fmla="*/ adyO sdelO 1" /><gd name="q14" fmla="*/ DO dxO -1" /><gd name="dyF1" fmla="+/ q14 q13 q4" /><gd name="q15" fmla="+- q14 0 q13" /><gd name="dyF2" fmla="*/ q15 1 q4" /><gd name="q16" fmla="+- x2O 0 dxF1" /><gd name="q17" fmla="+- x2O 0 dxF2" /><gd name="q18" fmla="+- y2O 0 dyF1" /><gd name="q19" fmla="+- y2O 0 dyF2" /><gd name="q20" fmla="mod q16 q18 0" /><gd name="q21" fmla="mod q17 q19 0" /><gd name="q22" fmla="+- q21 0 q20" /><gd name="dxF" fmla="?: q22 dxF1 dxF2" /><gd name="dyF" fmla="?: q22 dyF1 dyF2" /><gd name="sdxF" fmla="*/ dxF rw1 rO" /><gd name="sdyF" fmla="*/ dyF rh1 rO" /><gd name="xF" fmla="+- hc sdxF 0" /><gd name="yF" fmla="+- vc sdyF 0" /><gd name="x1I" fmla="*/ sx1 rI rw2" /><gd name="y1I" fmla="*/ sy1 rI rh2" /><gd name="x2I" fmla="*/ sx2 rI rw2" /><gd name="y2I" fmla="*/ sy2 rI rh2" /><gd name="dxI" fmla="+- x2I 0 x1I" /><gd name="dyI" fmla="+- y2I 0 y1I" /><gd name="dI" fmla="mod dxI dyI 0" /><gd name="v1" fmla="*/ x1I y2I 1" /><gd name="v2" fmla="*/ x2I y1I 1" /><gd name="DI" fmla="+- v1 0 v2" /><gd name="v3" fmla="*/ rI rI 1" /><gd name="v4" fmla="*/ dI dI 1" /><gd name="v5" fmla="*/ v3 v4 1" /><gd name="v6" fmla="*/ DI DI 1" /><gd name="v7" fmla="+- v5 0 v6" /><gd name="v8" fmla="max v7 0" /><gd name="sdelI" fmla="sqrt v8" /><gd name="v9" fmla="*/ sdyO dxI 1" /><gd name="v10" fmla="*/ v9 sdelI 1" /><gd name="v11" fmla="*/ DI dyI 1" /><gd name="dxC1" fmla="+/ v11 v10 v4" /><gd name="v12" fmla="+- v11 0 v10" /><gd name="dxC2" fmla="*/ v12 1 v4" /><gd name="adyI" fmla="abs dyI" /><gd name="v13" fmla="*/ adyI sdelI 1" /><gd name="v14" fmla="*/ DI dxI -1" /><gd name="dyC1" fmla="+/ v14 v13 v4" /><gd name="v15" fmla="+- v14 0 v13" /><gd name="dyC2" fmla="*/ v15 1 v4" /><gd name="v16" fmla="+- x1I 0 dxC1" /><gd name="v17" fmla="+- x1I 0 dxC2" /><gd name="v18" fmla="+- y1I 0 dyC1" /><gd name="v19" fmla="+- y1I 0 dyC2" /><gd name="v20" fmla="mod v16 v18 0" /><gd name="v21" fmla="mod v17 v19 0" /><gd name="v22" fmla="+- v21 0 v20" /><gd name="dxC" fmla="?: v22 dxC1 dxC2" /><gd name="dyC" fmla="?: v22 dyC1 dyC2" /><gd name="sdxC" fmla="*/ dxC rw2 rI" /><gd name="sdyC" fmla="*/ dyC rh2 rI" /><gd name="xC" fmla="+- hc sdxC 0" /><gd name="yC" fmla="+- vc sdyC 0" /><gd name="ist0" fmla="at2 sdxC sdyC" /><gd name="ist1" fmla="+- ist0 21600000 0" /><gd name="istAng0" fmla="?: ist0 ist0 ist1" /><gd name="isw1" fmla="+- stAng 0 istAng0" /><gd name="isw2" fmla="+- isw1 21600000 0" /><gd name="iswAng0" fmla="?: isw1 isw1 isw2" /><gd name="istAng" fmla="+- istAng0 iswAng0 0" /><gd name="iswAng" fmla="+- 0 0 iswAng0" /><gd name="p1" fmla="+- xF 0 xC" /><gd name="p2" fmla="+- yF 0 yC" /><gd name="p3" fmla="mod p1 p2 0" /><gd name="p4" fmla="*/ p3 1 2" /><gd name="p5" fmla="+- p4 0 thh" /><gd name="xGp" fmla="?: p5 xF xG" /><gd name="yGp" fmla="?: p5 yF yG" /><gd name="xBp" fmla="?: p5 xC xB" /><gd name="yBp" fmla="?: p5 yC yB" /><gd name="en0" fmla="at2 sdxF sdyF" /><gd name="en1" fmla="+- en0 21600000 0" /><gd name="en2" fmla="?: en0 en0 en1" /><gd name="sw0" fmla="+- en2 0 stAng" /><gd name="sw1" fmla="+- sw0 0 21600000" /><gd name="swAng" fmla="?: sw0 sw1 sw0" /><gd name="stAng0" fmla="+- stAng swAng 0" /><gd name="swAng0" fmla="+- 0 0 swAng" /><gd name="wtI" fmla="sin rw3 stAng" /><gd name="htI" fmla="cos rh3 stAng" /><gd name="dxI" fmla="cat2 rw3 htI wtI" /><gd name="dyI" fmla="sat2 rh3 htI wtI" /><gd name="xI" fmla="+- hc dxI 0" /><gd name="yI" fmla="+- vc dyI 0" /><gd name="aI" fmla="+- stAng cd4 0" /><gd name="aA" fmla="+- ptAng 0 cd4" /><gd name="aB" fmla="+- ptAng cd2 0" /><gd name="idx" fmla="cos rw1 2700000" /><gd name="idy" fmla="sin rh1 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="ir" fmla="+- hc idx 0" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ib" fmla="+- vc idy 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefAng="adj2" minAng="minAng" maxAng="0"><pos x="xA" y="yA" /></ahPolar><ahPolar gdRefAng="adj4" minAng="0" maxAng="21599999"><pos x="xE" y="yE" /></ahPolar><ahPolar gdRefR="adj1" minR="0" maxR="maxAdj1" gdRefAng="adj3" minAng="0" maxAng="21599999"><pos x="xF" y="yF" /></ahPolar><ahPolar gdRefR="adj5" minR="0" maxR="25000"><pos x="xB" y="yB" /></ahPolar></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="aI"><pos x="xI" y="yI" /></cxn><cxn ang="ptAng"><pos x="xGp" y="yGp" /></cxn><cxn ang="aA"><pos x="xA" y="yA" /></cxn><cxn ang="aB"><pos x="xBp" y="yBp" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="xE" y="yE" /></moveTo><lnTo><pt x="xD" y="yD" /></lnTo><arcTo wR="rw2" hR="rh2" stAng="istAng" swAng="iswAng" /><lnTo><pt x="xBp" y="yBp" /></lnTo><lnTo><pt x="xA" y="yA" /></lnTo><lnTo><pt x="xGp" y="yGp" /></lnTo><lnTo><pt x="xF" y="yF" /></lnTo><arcTo wR="rw1" hR="rh1" stAng="stAng0" swAng="swAng0" /><close /></path></pathLst>';
var po = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 50000" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 50000 w ss" /><gd name="a1" fmla="pin 0 adj1 100000" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="x2" fmla="*/ ss a2 100000" /><gd name="x3" fmla="+- r 0 x2" /><gd name="dy" fmla="*/ h a1 200000" /><gd name="y1" fmla="+- vc 0 dy" /><gd name="y2" fmla="+- vc dy 0" /><gd name="dx1" fmla="*/ y1 x2 hd2" /><gd name="x1" fmla="+- x2 0 dx1" /><gd name="x4" fmla="+- x3 dx1 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="100000"><pos x="x3" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="maxAdj2"><pos x="x2" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="x3" y="b" /></cxn><cxn ang="cd4"><pos x="x2" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="x2" y="t" /></cxn><cxn ang="3cd4"><pos x="x3" y="t" /></cxn></cxnLst><rect l="x1" t="y1" r="x4" b="y2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="x3" y="y1" /></lnTo><lnTo><pt x="x3" y="t" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="x3" y="b" /></lnTo><lnTo><pt x="x3" y="y2" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x2" y="b" /></lnTo><close /></path></pathLst>';
var io = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 25000" /><gd name="adj3" fmla="val 25000" /><gd name="adj4" fmla="val 48123" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 50000 h ss" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="maxAdj1" fmla="*/ a2 2 1" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="maxAdj3" fmla="*/ 50000 w ss" /><gd name="a3" fmla="pin 0 adj3 maxAdj3" /><gd name="q2" fmla="*/ a3 ss wd2" /><gd name="maxAdj4" fmla="+- 100000 0 q2" /><gd name="a4" fmla="pin 0 adj4 maxAdj4" /><gd name="dy1" fmla="*/ ss a2 100000" /><gd name="dy2" fmla="*/ ss a1 200000" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y2" fmla="+- vc 0 dy2" /><gd name="y3" fmla="+- vc dy2 0" /><gd name="y4" fmla="+- vc dy1 0" /><gd name="x1" fmla="*/ ss a3 100000" /><gd name="x4" fmla="+- r 0 x1" /><gd name="dx2" fmla="*/ w a4 200000" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- hc dx2 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="maxAdj1"><pos x="x1" y="y2" /></ahXY><ahXY gdRefY="adj2" minY="0" maxY="maxAdj2"><pos x="l" y="y1" /></ahXY><ahXY gdRefX="adj3" minX="0" maxX="maxAdj3"><pos x="x1" y="t" /></ahXY><ahXY gdRefX="adj4" minX="0" maxX="maxAdj4"><pos x="x2" y="b" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="x2" t="t" r="x3" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="x1" y="y1" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="x3" y="t" /></lnTo><lnTo><pt x="x3" y="y2" /></lnTo><lnTo><pt x="x4" y="y2" /></lnTo><lnTo><pt x="x4" y="y1" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="x4" y="y4" /></lnTo><lnTo><pt x="x4" y="y3" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo><lnTo><pt x="x3" y="b" /></lnTo><lnTo><pt x="x2" y="b" /></lnTo><lnTo><pt x="x2" y="y3" /></lnTo><lnTo><pt x="x1" y="y3" /></lnTo><lnTo><pt x="x1" y="y4" /></lnTo><close /></path></pathLst>';
var fo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 12500" /><gd name="adj2" fmla="val 1142319" /><gd name="adj3" fmla="val 20457681" /><gd name="adj4" fmla="val 11942319" /><gd name="adj5" fmla="val 12500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a5" fmla="pin 0 adj5 25000" /><gd name="maxAdj1" fmla="*/ a5 2 1" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="enAng" fmla="pin 1 adj3 21599999" /><gd name="stAng" fmla="pin 0 adj4 21599999" /><gd name="th" fmla="*/ ss a1 100000" /><gd name="thh" fmla="*/ ss a5 100000" /><gd name="th2" fmla="*/ th 1 2" /><gd name="rw1" fmla="+- wd2 th2 thh" /><gd name="rh1" fmla="+- hd2 th2 thh" /><gd name="rw2" fmla="+- rw1 0 th" /><gd name="rh2" fmla="+- rh1 0 th" /><gd name="rw3" fmla="+- rw2 th2 0" /><gd name="rh3" fmla="+- rh2 th2 0" /><gd name="wtH" fmla="sin rw3 enAng" /><gd name="htH" fmla="cos rh3 enAng" /><gd name="dxH" fmla="cat2 rw3 htH wtH" /><gd name="dyH" fmla="sat2 rh3 htH wtH" /><gd name="xH" fmla="+- hc dxH 0" /><gd name="yH" fmla="+- vc dyH 0" /><gd name="rI" fmla="min rw2 rh2" /><gd name="u1" fmla="*/ dxH dxH 1" /><gd name="u2" fmla="*/ dyH dyH 1" /><gd name="u3" fmla="*/ rI rI 1" /><gd name="u4" fmla="+- u1 0 u3" /><gd name="u5" fmla="+- u2 0 u3" /><gd name="u6" fmla="*/ u4 u5 u1" /><gd name="u7" fmla="*/ u6 1 u2" /><gd name="u8" fmla="+- 1 0 u7" /><gd name="u9" fmla="sqrt u8" /><gd name="u10" fmla="*/ u4 1 dxH" /><gd name="u11" fmla="*/ u10 1 dyH" /><gd name="u12" fmla="+/ 1 u9 u11" /><gd name="u13" fmla="at2 1 u12" /><gd name="u14" fmla="+- u13 21600000 0" /><gd name="u15" fmla="?: u13 u13 u14" /><gd name="u16" fmla="+- u15 0 enAng" /><gd name="u17" fmla="+- u16 21600000 0" /><gd name="u18" fmla="?: u16 u16 u17" /><gd name="u19" fmla="+- u18 0 cd2" /><gd name="u20" fmla="+- u18 0 21600000" /><gd name="u21" fmla="?: u19 u20 u18" /><gd name="maxAng" fmla="abs u21" /><gd name="aAng" fmla="pin 0 adj2 maxAng" /><gd name="ptAng" fmla="+- enAng aAng 0" /><gd name="wtA" fmla="sin rw3 ptAng" /><gd name="htA" fmla="cos rh3 ptAng" /><gd name="dxA" fmla="cat2 rw3 htA wtA" /><gd name="dyA" fmla="sat2 rh3 htA wtA" /><gd name="xA" fmla="+- hc dxA 0" /><gd name="yA" fmla="+- vc dyA 0" /><gd name="dxG" fmla="cos thh ptAng" /><gd name="dyG" fmla="sin thh ptAng" /><gd name="xG" fmla="+- xH dxG 0" /><gd name="yG" fmla="+- yH dyG 0" /><gd name="dxB" fmla="cos thh ptAng" /><gd name="dyB" fmla="sin thh ptAng" /><gd name="xB" fmla="+- xH 0 dxB 0" /><gd name="yB" fmla="+- yH 0 dyB 0" /><gd name="sx1" fmla="+- xB 0 hc" /><gd name="sy1" fmla="+- yB 0 vc" /><gd name="sx2" fmla="+- xG 0 hc" /><gd name="sy2" fmla="+- yG 0 vc" /><gd name="rO" fmla="min rw1 rh1" /><gd name="x1O" fmla="*/ sx1 rO rw1" /><gd name="y1O" fmla="*/ sy1 rO rh1" /><gd name="x2O" fmla="*/ sx2 rO rw1" /><gd name="y2O" fmla="*/ sy2 rO rh1" /><gd name="dxO" fmla="+- x2O 0 x1O" /><gd name="dyO" fmla="+- y2O 0 y1O" /><gd name="dO" fmla="mod dxO dyO 0" /><gd name="q1" fmla="*/ x1O y2O 1" /><gd name="q2" fmla="*/ x2O y1O 1" /><gd name="DO" fmla="+- q1 0 q2" /><gd name="q3" fmla="*/ rO rO 1" /><gd name="q4" fmla="*/ dO dO 1" /><gd name="q5" fmla="*/ q3 q4 1" /><gd name="q6" fmla="*/ DO DO 1" /><gd name="q7" fmla="+- q5 0 q6" /><gd name="q8" fmla="max q7 0" /><gd name="sdelO" fmla="sqrt q8" /><gd name="ndyO" fmla="*/ dyO -1 1" /><gd name="sdyO" fmla="?: ndyO -1 1" /><gd name="q9" fmla="*/ sdyO dxO 1" /><gd name="q10" fmla="*/ q9 sdelO 1" /><gd name="q11" fmla="*/ DO dyO 1" /><gd name="dxF1" fmla="+/ q11 q10 q4" /><gd name="q12" fmla="+- q11 0 q10" /><gd name="dxF2" fmla="*/ q12 1 q4" /><gd name="adyO" fmla="abs dyO" /><gd name="q13" fmla="*/ adyO sdelO 1" /><gd name="q14" fmla="*/ DO dxO -1" /><gd name="dyF1" fmla="+/ q14 q13 q4" /><gd name="q15" fmla="+- q14 0 q13" /><gd name="dyF2" fmla="*/ q15 1 q4" /><gd name="q16" fmla="+- x2O 0 dxF1" /><gd name="q17" fmla="+- x2O 0 dxF2" /><gd name="q18" fmla="+- y2O 0 dyF1" /><gd name="q19" fmla="+- y2O 0 dyF2" /><gd name="q20" fmla="mod q16 q18 0" /><gd name="q21" fmla="mod q17 q19 0" /><gd name="q22" fmla="+- q21 0 q20" /><gd name="dxF" fmla="?: q22 dxF1 dxF2" /><gd name="dyF" fmla="?: q22 dyF1 dyF2" /><gd name="sdxF" fmla="*/ dxF rw1 rO" /><gd name="sdyF" fmla="*/ dyF rh1 rO" /><gd name="xF" fmla="+- hc sdxF 0" /><gd name="yF" fmla="+- vc sdyF 0" /><gd name="x1I" fmla="*/ sx1 rI rw2" /><gd name="y1I" fmla="*/ sy1 rI rh2" /><gd name="x2I" fmla="*/ sx2 rI rw2" /><gd name="y2I" fmla="*/ sy2 rI rh2" /><gd name="dxI" fmla="+- x2I 0 x1I" /><gd name="dyI" fmla="+- y2I 0 y1I" /><gd name="dI" fmla="mod dxI dyI 0" /><gd name="v1" fmla="*/ x1I y2I 1" /><gd name="v2" fmla="*/ x2I y1I 1" /><gd name="DI" fmla="+- v1 0 v2" /><gd name="v3" fmla="*/ rI rI 1" /><gd name="v4" fmla="*/ dI dI 1" /><gd name="v5" fmla="*/ v3 v4 1" /><gd name="v6" fmla="*/ DI DI 1" /><gd name="v7" fmla="+- v5 0 v6" /><gd name="v8" fmla="max v7 0" /><gd name="sdelI" fmla="sqrt v8" /><gd name="v9" fmla="*/ sdyO dxI 1" /><gd name="v10" fmla="*/ v9 sdelI 1" /><gd name="v11" fmla="*/ DI dyI 1" /><gd name="dxC1" fmla="+/ v11 v10 v4" /><gd name="v12" fmla="+- v11 0 v10" /><gd name="dxC2" fmla="*/ v12 1 v4" /><gd name="adyI" fmla="abs dyI" /><gd name="v13" fmla="*/ adyI sdelI 1" /><gd name="v14" fmla="*/ DI dxI -1" /><gd name="dyC1" fmla="+/ v14 v13 v4" /><gd name="v15" fmla="+- v14 0 v13" /><gd name="dyC2" fmla="*/ v15 1 v4" /><gd name="v16" fmla="+- x1I 0 dxC1" /><gd name="v17" fmla="+- x1I 0 dxC2" /><gd name="v18" fmla="+- y1I 0 dyC1" /><gd name="v19" fmla="+- y1I 0 dyC2" /><gd name="v20" fmla="mod v16 v18 0" /><gd name="v21" fmla="mod v17 v19 0" /><gd name="v22" fmla="+- v21 0 v20" /><gd name="dxC" fmla="?: v22 dxC1 dxC2" /><gd name="dyC" fmla="?: v22 dyC1 dyC2" /><gd name="sdxC" fmla="*/ dxC rw2 rI" /><gd name="sdyC" fmla="*/ dyC rh2 rI" /><gd name="xC" fmla="+- hc sdxC 0" /><gd name="yC" fmla="+- vc sdyC 0" /><gd name="wtI" fmla="sin rw3 stAng" /><gd name="htI" fmla="cos rh3 stAng" /><gd name="dxI" fmla="cat2 rw3 htI wtI" /><gd name="dyI" fmla="sat2 rh3 htI wtI" /><gd name="xI" fmla="+- hc dxI 0" /><gd name="yI" fmla="+- vc dyI 0" /><gd name="lptAng" fmla="+- stAng 0 aAng" /><gd name="wtL" fmla="sin rw3 lptAng" /><gd name="htL" fmla="cos rh3 lptAng" /><gd name="dxL" fmla="cat2 rw3 htL wtL" /><gd name="dyL" fmla="sat2 rh3 htL wtL" /><gd name="xL" fmla="+- hc dxL 0" /><gd name="yL" fmla="+- vc dyL 0" /><gd name="dxK" fmla="cos thh lptAng" /><gd name="dyK" fmla="sin thh lptAng" /><gd name="xK" fmla="+- xI dxK 0" /><gd name="yK" fmla="+- yI dyK 0" /><gd name="dxJ" fmla="cos thh lptAng" /><gd name="dyJ" fmla="sin thh lptAng" /><gd name="xJ" fmla="+- xI 0 dxJ 0" /><gd name="yJ" fmla="+- yI 0 dyJ 0" /><gd name="p1" fmla="+- xF 0 xC" /><gd name="p2" fmla="+- yF 0 yC" /><gd name="p3" fmla="mod p1 p2 0" /><gd name="p4" fmla="*/ p3 1 2" /><gd name="p5" fmla="+- p4 0 thh" /><gd name="xGp" fmla="?: p5 xF xG" /><gd name="yGp" fmla="?: p5 yF yG" /><gd name="xBp" fmla="?: p5 xC xB" /><gd name="yBp" fmla="?: p5 yC yB" /><gd name="en0" fmla="at2 sdxF sdyF" /><gd name="en1" fmla="+- en0 21600000 0" /><gd name="en2" fmla="?: en0 en0 en1" /><gd name="od0" fmla="+- en2 0 enAng" /><gd name="od1" fmla="+- od0 21600000 0" /><gd name="od2" fmla="?: od0 od0 od1" /><gd name="st0" fmla="+- stAng 0 od2" /><gd name="st1" fmla="+- st0 21600000 0" /><gd name="st2" fmla="?: st0 st0 st1" /><gd name="sw0" fmla="+- en2 0 st2" /><gd name="sw1" fmla="+- sw0 21600000 0" /><gd name="swAng" fmla="?: sw0 sw0 sw1" /><gd name="ist0" fmla="at2 sdxC sdyC" /><gd name="ist1" fmla="+- ist0 21600000 0" /><gd name="istAng" fmla="?: ist0 ist0 ist1" /><gd name="id0" fmla="+- istAng 0 enAng" /><gd name="id1" fmla="+- id0 0 21600000" /><gd name="id2" fmla="?: id0 id1 id0" /><gd name="ien0" fmla="+- stAng 0 id2" /><gd name="ien1" fmla="+- ien0 0 21600000" /><gd name="ien2" fmla="?: ien1 ien1 ien0" /><gd name="isw1" fmla="+- ien2 0 istAng" /><gd name="isw2" fmla="+- isw1 0 21600000" /><gd name="iswAng" fmla="?: isw1 isw2 isw1" /><gd name="wtE" fmla="sin rw1 st2" /><gd name="htE" fmla="cos rh1 st2" /><gd name="dxE" fmla="cat2 rw1 htE wtE" /><gd name="dyE" fmla="sat2 rh1 htE wtE" /><gd name="xE" fmla="+- hc dxE 0" /><gd name="yE" fmla="+- vc dyE 0" /><gd name="wtD" fmla="sin rw2 ien2" /><gd name="htD" fmla="cos rh2 ien2" /><gd name="dxD" fmla="cat2 rw2 htD wtD" /><gd name="dyD" fmla="sat2 rh2 htD wtD" /><gd name="xD" fmla="+- hc dxD 0" /><gd name="yD" fmla="+- vc dyD 0" /><gd name="xKp" fmla="?: p5 xE xK" /><gd name="yKp" fmla="?: p5 yE yK" /><gd name="xJp" fmla="?: p5 xD xJ" /><gd name="yJp" fmla="?: p5 yD yJ" /><gd name="aL" fmla="+- lptAng 0 cd4" /><gd name="aA" fmla="+- ptAng cd4 0" /><gd name="aB" fmla="+- ptAng cd2 0" /><gd name="aJ" fmla="+- lptAng cd2 0" /><gd name="idx" fmla="cos rw1 2700000" /><gd name="idy" fmla="sin rh1 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="ir" fmla="+- hc idx 0" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ib" fmla="+- vc idy 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefAng="adj2" minAng="0" maxAng="maxAng"><pos x="xA" y="yA" /></ahPolar><ahPolar gdRefAng="adj4" minAng="0" maxAng="21599999"><pos x="xE" y="yE" /></ahPolar><ahPolar gdRefR="adj1" minR="0" maxR="maxAdj1" gdRefAng="adj3" minAng="0" maxAng="21599999"><pos x="xF" y="yF" /></ahPolar><ahPolar gdRefR="adj5" minR="0" maxR="25000"><pos x="xB" y="yB" /></ahPolar></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="aL"><pos x="xL" y="yL" /></cxn><cxn ang="lptAng"><pos x="xKp" y="yKp" /></cxn><cxn ang="ptAng"><pos x="xGp" y="yGp" /></cxn><cxn ang="aA"><pos x="xA" y="yA" /></cxn><cxn ang="aB"><pos x="xBp" y="yBp" /></cxn><cxn ang="aJ"><pos x="xJp" y="yJp" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="xL" y="yL" /></moveTo><lnTo><pt x="xKp" y="yKp" /></lnTo><lnTo><pt x="xE" y="yE" /></lnTo><arcTo wR="rw1" hR="rh1" stAng="st2" swAng="swAng" /><lnTo><pt x="xGp" y="yGp" /></lnTo><lnTo><pt x="xA" y="yA" /></lnTo><lnTo><pt x="xBp" y="yBp" /></lnTo><lnTo><pt x="xC" y="yC" /></lnTo><arcTo wR="rw2" hR="rh2" stAng="istAng" swAng="iswAng" /><lnTo><pt x="xJp" y="yJp" /></lnTo><close /></path></pathLst>';
var ho = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 50000" /><gd name="adj2" fmla="val 50000" /><gd name="adj3" fmla="val 16667" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a3" fmla="pin 0 adj3 33333" /><gd name="maxAdj1" fmla="+- 100000 0 a3" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="w1" fmla="+- wd2 0 wd32" /><gd name="maxAdj2" fmla="*/ 100000 w1 ss" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="x1" fmla="*/ ss a2 100000" /><gd name="x4" fmla="+- r 0 x1" /><gd name="dy1" fmla="*/ h a1 200000" /><gd name="dy2" fmla="*/ h a3 -200000" /><gd name="ly1" fmla="+- vc dy2 dy1" /><gd name="ry4" fmla="+- vc dy1 dy2" /><gd name="ly2" fmla="+- ly1 dy1 0" /><gd name="ry3" fmla="+- b 0 ly2" /><gd name="ly4" fmla="*/ ly2 2 1" /><gd name="ry1" fmla="+- b 0 ly4" /><gd name="ly3" fmla="+- ly4 0 ly1" /><gd name="ry2" fmla="+- b 0 ly3" /><gd name="hR" fmla="*/ a3 ss 400000" /><gd name="x2" fmla="+- hc 0 wd32" /><gd name="x3" fmla="+- hc wd32 0" /><gd name="y1" fmla="+- ly1 hR 0" /><gd name="y2" fmla="+- ry2 0 hR" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="maxAdj1"><pos x="x4" y="ry2" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="maxAdj2"><pos x="x1" y="t" /></ahXY><ahXY gdRefY="adj3" minY="0" maxY="33333"><pos x="x3" y="ry2" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="ry3" /></cxn><cxn ang="cd4"><pos x="x4" y="b" /></cxn><cxn ang="cd4"><pos x="x1" y="ly4" /></cxn><cxn ang="cd2"><pos x="l" y="ly2" /></cxn><cxn ang="3cd4"><pos x="x1" y="t" /></cxn><cxn ang="3cd4"><pos x="x4" y="ry1" /></cxn></cxnLst><rect l="x1" t="ly1" r="x4" b="ry4" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="ly2" /></moveTo><lnTo><pt x="x1" y="t" /></lnTo><lnTo><pt x="x1" y="ly1" /></lnTo><lnTo><pt x="hc" y="ly1" /></lnTo><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="cd2" /><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="-10800000" /><lnTo><pt x="x4" y="ry2" /></lnTo><lnTo><pt x="x4" y="ry1" /></lnTo><lnTo><pt x="r" y="ry3" /></lnTo><lnTo><pt x="x4" y="b" /></lnTo><lnTo><pt x="x4" y="ry4" /></lnTo><lnTo><pt x="hc" y="ry4" /></lnTo><arcTo wR="wd32" hR="hR" stAng="cd4" swAng="cd4" /><lnTo><pt x="x2" y="ly3" /></lnTo><lnTo><pt x="x1" y="ly3" /></lnTo><lnTo><pt x="x1" y="ly4" /></lnTo><close /></path><path stroke="false" fill="darkenLess" extrusionOk="false"><moveTo><pt x="x3" y="y1" /></moveTo><arcTo wR="wd32" hR="hR" stAng="0" swAng="cd4" /><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="-10800000" /><lnTo><pt x="x3" y="ry2" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="l" y="ly2" /></moveTo><lnTo><pt x="x1" y="t" /></lnTo><lnTo><pt x="x1" y="ly1" /></lnTo><lnTo><pt x="hc" y="ly1" /></lnTo><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="cd2" /><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="-10800000" /><lnTo><pt x="x4" y="ry2" /></lnTo><lnTo><pt x="x4" y="ry1" /></lnTo><lnTo><pt x="r" y="ry3" /></lnTo><lnTo><pt x="x4" y="b" /></lnTo><lnTo><pt x="x4" y="ry4" /></lnTo><lnTo><pt x="hc" y="ry4" /></lnTo><arcTo wR="wd32" hR="hR" stAng="cd4" swAng="cd4" /><lnTo><pt x="x2" y="ly3" /></lnTo><lnTo><pt x="x1" y="ly3" /></lnTo><lnTo><pt x="x1" y="ly4" /></lnTo><close /><moveTo><pt x="x3" y="y1" /></moveTo><lnTo><pt x="x3" y="ry2" /></lnTo><moveTo><pt x="x2" y="y2" /></moveTo><lnTo><pt x="x2" y="ly3" /></lnTo></path></pathLst>';
var yo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 25000" /><gd name="adj3" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a2" fmla="pin 0 adj2 50000" /><gd name="maxAdj1" fmla="*/ a2 2 1" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="q1" fmla="+- 100000 0 maxAdj1" /><gd name="maxAdj3" fmla="*/ q1 1 2" /><gd name="a3" fmla="pin 0 adj3 maxAdj3" /><gd name="x1" fmla="*/ ss a3 100000" /><gd name="dx2" fmla="*/ ss a2 100000" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x5" fmla="+- hc dx2 0" /><gd name="dx3" fmla="*/ ss a1 200000" /><gd name="x3" fmla="+- hc 0 dx3" /><gd name="x4" fmla="+- hc dx3 0" /><gd name="x6" fmla="+- r 0 x1" /><gd name="dy2" fmla="*/ ss a2 50000" /><gd name="y2" fmla="+- b 0 dy2" /><gd name="y4" fmla="+- b 0 dx2" /><gd name="y3" fmla="+- y4 0 dx3" /><gd name="y5" fmla="+- y4 dx3 0" /><gd name="il" fmla="*/ dx3 x1 dx2" /><gd name="ir" fmla="+- r 0 il" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="maxAdj1"><pos x="x3" y="x1" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="50000"><pos x="x2" y="t" /></ahXY><ahXY gdRefY="adj3" minY="0" maxY="maxAdj3"><pos x="r" y="x1" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="y4" /></cxn><cxn ang="cd4"><pos x="hc" y="y5" /></cxn><cxn ang="0"><pos x="r" y="y4" /></cxn></cxnLst><rect l="il" t="y3" r="ir" b="y5" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y4" /></moveTo><lnTo><pt x="x1" y="y2" /></lnTo><lnTo><pt x="x1" y="y3" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo><lnTo><pt x="x3" y="x1" /></lnTo><lnTo><pt x="x2" y="x1" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="x5" y="x1" /></lnTo><lnTo><pt x="x4" y="x1" /></lnTo><lnTo><pt x="x4" y="y3" /></lnTo><lnTo><pt x="x6" y="y3" /></lnTo><lnTo><pt x="x6" y="y2" /></lnTo><lnTo><pt x="r" y="y4" /></lnTo><lnTo><pt x="x6" y="b" /></lnTo><lnTo><pt x="x6" y="y5" /></lnTo><lnTo><pt x="x1" y="y5" /></lnTo><lnTo><pt x="x1" y="b" /></lnTo><close /></path></pathLst>';
var To = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 25000" /><gd name="adj3" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a2" fmla="pin 0 adj2 50000" /><gd name="maxAdj1" fmla="*/ a2 2 1" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="maxAdj3" fmla="+- 100000 0 maxAdj1" /><gd name="a3" fmla="pin 0 adj3 maxAdj3" /><gd name="x1" fmla="*/ ss a3 100000" /><gd name="dx2" fmla="*/ ss a2 50000" /><gd name="x2" fmla="+- r 0 dx2" /><gd name="y2" fmla="+- b 0 dx2" /><gd name="dx4" fmla="*/ ss a2 100000" /><gd name="x4" fmla="+- r 0 dx4" /><gd name="y4" fmla="+- b 0 dx4" /><gd name="dx3" fmla="*/ ss a1 200000" /><gd name="x3" fmla="+- x4 0 dx3" /><gd name="x5" fmla="+- x4 dx3 0" /><gd name="y3" fmla="+- y4 0 dx3" /><gd name="y5" fmla="+- y4 dx3 0" /><gd name="il" fmla="*/ dx3 x1 dx4" /><gd name="cx1" fmla="+/ x1 x5 2" /><gd name="cy1" fmla="+/ x1 y5 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="maxAdj1"><pos x="x3" y="y3" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="50000"><pos x="x2" y="t" /></ahXY><ahXY gdRefY="adj3" minY="0" maxY="maxAdj3"><pos x="x3" y="x1" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x4" y="t" /></cxn><cxn ang="cd2"><pos x="x2" y="x1" /></cxn><cxn ang="3cd4"><pos x="x1" y="y2" /></cxn><cxn ang="cd2"><pos x="l" y="y4" /></cxn><cxn ang="cd4"><pos x="x1" y="b" /></cxn><cxn ang="cd4"><pos x="cx1" y="y5" /></cxn><cxn ang="0"><pos x="x5" y="cy1" /></cxn><cxn ang="0"><pos x="r" y="x1" /></cxn></cxnLst><rect l="il" t="y3" r="x4" b="y5" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y4" /></moveTo><lnTo><pt x="x1" y="y2" /></lnTo><lnTo><pt x="x1" y="y3" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo><lnTo><pt x="x3" y="x1" /></lnTo><lnTo><pt x="x2" y="x1" /></lnTo><lnTo><pt x="x4" y="t" /></lnTo><lnTo><pt x="r" y="x1" /></lnTo><lnTo><pt x="x5" y="x1" /></lnTo><lnTo><pt x="x5" y="y5" /></lnTo><lnTo><pt x="x1" y="y5" /></lnTo><lnTo><pt x="x1" y="b" /></lnTo><close /></path></pathLst>';
var wo = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="x1" fmla="*/ w 5022 21600" /><gd name="x3" fmla="*/ w 8472 21600" /><gd name="x4" fmla="*/ w 8757 21600" /><gd name="x5" fmla="*/ w 10012 21600" /><gd name="x8" fmla="*/ w 12860 21600" /><gd name="x9" fmla="*/ w 13917 21600" /><gd name="x11" fmla="*/ w 16577 21600" /><gd name="y1" fmla="*/ h 3890 21600" /><gd name="y2" fmla="*/ h 6080 21600" /><gd name="y4" fmla="*/ h 7437 21600" /><gd name="y6" fmla="*/ h 9705 21600" /><gd name="y7" fmla="*/ h 12007 21600" /><gd name="y10" fmla="*/ h 14277 21600" /><gd name="y11" fmla="*/ h 14915 21600" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x3" y="t" /></cxn><cxn ang="3cd4"><pos x="l" y="y1" /></cxn><cxn ang="cd2"><pos x="x1" y="y6" /></cxn><cxn ang="cd2"><pos x="x5" y="y11" /></cxn><cxn ang="cd4"><pos x="r" y="b" /></cxn><cxn ang="0"><pos x="x11" y="y7" /></cxn><cxn ang="0"><pos x="x8" y="y2" /></cxn></cxnLst><rect l="x4" t="y4" r="x9" b="y10" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path w="21600" h="21600"><moveTo><pt x="8472" y="0" /></moveTo><lnTo><pt x="12860" y="6080" /></lnTo><lnTo><pt x="11050" y="6797" /></lnTo><lnTo><pt x="16577" y="12007" /></lnTo><lnTo><pt x="14767" y="12877" /></lnTo><lnTo><pt x="21600" y="21600" /></lnTo><lnTo><pt x="10012" y="14915" /></lnTo><lnTo><pt x="12222" y="13987" /></lnTo><lnTo><pt x="5022" y="9705" /></lnTo><lnTo><pt x="7602" y="8382" /></lnTo><lnTo><pt x="0" y="3890" /></lnTo><close /></path></pathLst>';
var vo = '<cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd4"><pos x="l" y="t" /></cxn><cxn ang="3cd4"><pos x="r" y="b" /></cxn></cxnLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="b" /></lnTo></path></pathLst>';
var Lo = '<cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd4"><pos x="l" y="b" /></cxn><cxn ang="3cd4"><pos x="r" y="t" /></cxn></cxnLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="r" y="t" /></lnTo></path></pathLst>';
var uo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 23520" /><gd name="adj2" fmla="val 5880" /><gd name="adj3" fmla="val 11760" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 1000 adj1 36745" /><gd name="ma1" fmla="+- 0 0 a1" /><gd name="ma3h" fmla="+/ 73490 ma1 4" /><gd name="ma3w" fmla="*/ 36745 w h" /><gd name="maxAdj3" fmla="min ma3h ma3w" /><gd name="a3" fmla="pin 1000 adj3 maxAdj3" /><gd name="m4a3" fmla="*/ -4 a3 1" /><gd name="maxAdj2" fmla="+- 73490 m4a3 a1" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="dy1" fmla="*/ h a1 200000" /><gd name="yg" fmla="*/ h a2 100000" /><gd name="rad" fmla="*/ h a3 100000" /><gd name="dx1" fmla="*/ w 73490 200000" /><gd name="y3" fmla="+- vc 0 dy1" /><gd name="y4" fmla="+- vc dy1 0" /><gd name="a" fmla="+- yg rad 0" /><gd name="y2" fmla="+- y3 0 a" /><gd name="y1" fmla="+- y2 0 rad" /><gd name="y5" fmla="+- b 0 y1" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x3" fmla="+- hc dx1 0" /><gd name="x2" fmla="+- hc 0 rad" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="1000" maxY="36745"><pos x="l" y="y3" /></ahXY><ahXY gdRefY="adj2" minY="0" maxY="maxAdj2"><pos x="r" y="y2" /></ahXY><ahXY gdRefX="adj3" minX="1000" maxX="maxAdj3"><pos x="x2" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="x3" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="y5" /></cxn><cxn ang="cd2"><pos x="x1" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="y1" /></cxn></cxnLst><rect l="x1" t="y3" r="x3" b="y4" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="hc" y="y1" /></moveTo><arcTo hR="rad" wR="rad" stAng="3cd4" swAng="21600000" /><close /><moveTo><pt x="hc" y="y5" /></moveTo><arcTo hR="rad" wR="rad" stAng="cd4" swAng="21600000" /><close /><moveTo><pt x="x1" y="y3" /></moveTo><lnTo><pt x="x3" y="y3" /></lnTo><lnTo><pt x="x3" y="y4" /></lnTo><lnTo><pt x="x1" y="y4" /></lnTo><close /></path></pathLst>';
var Ao = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 23520" /><gd name="adj2" fmla="val 11760" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 36745" /><gd name="2a1" fmla="*/ a1 2 1" /><gd name="mAdj2" fmla="+- 100000 0 2a1" /><gd name="a2" fmla="pin 0 adj2 mAdj2" /><gd name="dy1" fmla="*/ h a1 100000" /><gd name="dy2" fmla="*/ h a2 200000" /><gd name="dx1" fmla="*/ w 73490 200000" /><gd name="y2" fmla="+- vc 0 dy2" /><gd name="y3" fmla="+- vc dy2 0" /><gd name="y1" fmla="+- y2 0 dy1" /><gd name="y4" fmla="+- y3 dy1 0" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc dx1 0" /><gd name="yC1" fmla="+/ y1 y2 2" /><gd name="yC2" fmla="+/ y3 y4 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="36745"><pos x="l" y="y1" /></ahXY><ahXY gdRefY="adj2" minY="0" maxY="mAdj2"><pos x="r" y="y2" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="x2" y="yC1" /></cxn><cxn ang="0"><pos x="x2" y="yC2" /></cxn><cxn ang="cd4"><pos x="hc" y="y4" /></cxn><cxn ang="cd2"><pos x="x1" y="yC1" /></cxn><cxn ang="cd2"><pos x="x1" y="yC2" /></cxn><cxn ang="3cd4"><pos x="hc" y="y1" /></cxn></cxnLst><rect l="x1" t="y1" r="x2" b="y4" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><close /><moveTo><pt x="x1" y="y3" /></moveTo><lnTo><pt x="x2" y="y3" /></lnTo><lnTo><pt x="x2" y="y4" /></lnTo><lnTo><pt x="x1" y="y4" /></lnTo><close /></path></pathLst>';
var bo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 23520" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 100000" /><gd name="dy1" fmla="*/ h a1 200000" /><gd name="dx1" fmla="*/ w 73490 200000" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y2" fmla="+- vc dy1 0" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc dx1 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="100000"><pos x="l" y="y1" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="x2" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="y2" /></cxn><cxn ang="cd2"><pos x="x1" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="y1" /></cxn></cxnLst><rect l="x1" t="y1" r="x2" b="y2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><close /></path></pathLst>';
var jo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 23520" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 51965" /><gd name="th" fmla="*/ ss a1 100000" /><gd name="a" fmla="at2 w h" /><gd name="sa" fmla="sin 1 a" /><gd name="ca" fmla="cos 1 a" /><gd name="ta" fmla="tan 1 a" /><gd name="dl" fmla="mod w h 0" /><gd name="rw" fmla="*/ dl 51965 100000" /><gd name="lM" fmla="+- dl 0 rw" /><gd name="xM" fmla="*/ ca lM 2" /><gd name="yM" fmla="*/ sa lM 2" /><gd name="dxAM" fmla="*/ sa th 2" /><gd name="dyAM" fmla="*/ ca th 2" /><gd name="xA" fmla="+- xM 0 dxAM" /><gd name="yA" fmla="+- yM dyAM 0" /><gd name="xB" fmla="+- xM dxAM 0" /><gd name="yB" fmla="+- yM 0 dyAM" /><gd name="xBC" fmla="+- hc 0 xB" /><gd name="yBC" fmla="*/ xBC ta 1" /><gd name="yC" fmla="+- yBC yB 0" /><gd name="xD" fmla="+- r 0 xB" /><gd name="xE" fmla="+- r 0 xA" /><gd name="yFE" fmla="+- vc 0 yA" /><gd name="xFE" fmla="*/ yFE 1 ta" /><gd name="xF" fmla="+- xE 0 xFE" /><gd name="xL" fmla="+- xA xFE 0" /><gd name="yG" fmla="+- b 0 yA" /><gd name="yH" fmla="+- b 0 yB" /><gd name="yI" fmla="+- b 0 yC" /><gd name="xC2" fmla="+- r 0 xM" /><gd name="yC3" fmla="+- b 0 yM" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="51965"><pos x="l" y="th" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd2"><pos x="xM" y="yM" /></cxn><cxn ang="3cd4"><pos x="xC2" y="yM" /></cxn><cxn ang="0"><pos x="xC2" y="yC3" /></cxn><cxn ang="cd4"><pos x="xM" y="yC3" /></cxn></cxnLst><rect l="xA" t="yB" r="xE" b="yH" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="xA" y="yA" /></moveTo><lnTo><pt x="xB" y="yB" /></lnTo><lnTo><pt x="hc" y="yC" /></lnTo><lnTo><pt x="xD" y="yB" /></lnTo><lnTo><pt x="xE" y="yA" /></lnTo><lnTo><pt x="xF" y="vc" /></lnTo><lnTo><pt x="xE" y="yG" /></lnTo><lnTo><pt x="xD" y="yH" /></lnTo><lnTo><pt x="hc" y="yI" /></lnTo><lnTo><pt x="xB" y="yH" /></lnTo><lnTo><pt x="xA" y="yG" /></lnTo><lnTo><pt x="xL" y="vc" /></lnTo><close /></path></pathLst>';
var $o = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 23520" /><gd name="adj2" fmla="val 6600000" /><gd name="adj3" fmla="val 11760" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 50000" /><gd name="crAng" fmla="pin 4200000 adj2 6600000" /><gd name="2a1" fmla="*/ a1 2 1" /><gd name="maxAdj3" fmla="+- 100000 0 2a1" /><gd name="a3" fmla="pin 0 adj3 maxAdj3" /><gd name="dy1" fmla="*/ h a1 100000" /><gd name="dy2" fmla="*/ h a3 200000" /><gd name="dx1" fmla="*/ w 73490 200000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x8" fmla="+- hc dx1 0" /><gd name="y2" fmla="+- vc 0 dy2" /><gd name="y3" fmla="+- vc dy2 0" /><gd name="y1" fmla="+- y2 0 dy1" /><gd name="y4" fmla="+- y3 dy1 0" /><gd name="cadj2" fmla="+- crAng 0 cd4" /><gd name="xadj2" fmla="tan hd2 cadj2" /><gd name="len" fmla="mod xadj2 hd2 0" /><gd name="bhw" fmla="*/ len dy1 hd2" /><gd name="bhw2" fmla="*/ bhw 1 2" /><gd name="x7" fmla="+- hc xadj2 bhw2" /><gd name="dx67" fmla="*/ xadj2 y1 hd2" /><gd name="x6" fmla="+- x7 0 dx67" /><gd name="dx57" fmla="*/ xadj2 y2 hd2" /><gd name="x5" fmla="+- x7 0 dx57" /><gd name="dx47" fmla="*/ xadj2 y3 hd2" /><gd name="x4" fmla="+- x7 0 dx47" /><gd name="dx37" fmla="*/ xadj2 y4 hd2" /><gd name="x3" fmla="+- x7 0 dx37" /><gd name="dx27" fmla="*/ xadj2 2 1" /><gd name="x2" fmla="+- x7 0 dx27" /><gd name="rx7" fmla="+- x7 bhw 0" /><gd name="rx6" fmla="+- x6 bhw 0" /><gd name="rx5" fmla="+- x5 bhw 0" /><gd name="rx4" fmla="+- x4 bhw 0" /><gd name="rx3" fmla="+- x3 bhw 0" /><gd name="rx2" fmla="+- x2 bhw 0" /><gd name="dx7" fmla="*/ dy1 hd2 len" /><gd name="rxt" fmla="+- x7 dx7 0" /><gd name="lxt" fmla="+- rx7 0 dx7" /><gd name="rx" fmla="?: cadj2 rxt rx7" /><gd name="lx" fmla="?: cadj2 x7 lxt" /><gd name="dy3" fmla="*/ dy1 xadj2 len" /><gd name="dy4" fmla="+- 0 0 dy3" /><gd name="ry" fmla="?: cadj2 dy3 t" /><gd name="ly" fmla="?: cadj2 t dy4" /><gd name="dlx" fmla="+- w 0 rx" /><gd name="drx" fmla="+- w 0 lx" /><gd name="dly" fmla="+- h 0 ry" /><gd name="dry" fmla="+- h 0 ly" /><gd name="xC1" fmla="+/ rx lx 2" /><gd name="xC2" fmla="+/ drx dlx 2" /><gd name="yC1" fmla="+/ ry ly 2" /><gd name="yC2" fmla="+/ y1 y2 2" /><gd name="yC3" fmla="+/ y3 y4 2" /><gd name="yC4" fmla="+/ dry dly 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="50000"><pos x="l" y="y1" /></ahXY><ahPolar gdRefAng="adj2" minAng="4200000" maxAng="6600000"><pos x="lx" y="t" /></ahPolar><ahXY gdRefY="adj3" minY="0" maxY="maxAdj3"><pos x="r" y="y2" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="x8" y="yC2" /></cxn><cxn ang="0"><pos x="x8" y="yC3" /></cxn><cxn ang="cd4"><pos x="xC2" y="yC4" /></cxn><cxn ang="cd2"><pos x="x1" y="yC2" /></cxn><cxn ang="cd2"><pos x="x1" y="yC3" /></cxn><cxn ang="3cd4"><pos x="xC1" y="yC1" /></cxn></cxnLst><rect l="x1" t="y1" r="x8" b="y4" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="x6" y="y1" /></lnTo><lnTo><pt x="lx" y="ly" /></lnTo><lnTo><pt x="rx" y="ry" /></lnTo><lnTo><pt x="rx6" y="y1" /></lnTo><lnTo><pt x="x8" y="y1" /></lnTo><lnTo><pt x="x8" y="y2" /></lnTo><lnTo><pt x="rx5" y="y2" /></lnTo><lnTo><pt x="rx4" y="y3" /></lnTo><lnTo><pt x="x8" y="y3" /></lnTo><lnTo><pt x="x8" y="y4" /></lnTo><lnTo><pt x="rx3" y="y4" /></lnTo><lnTo><pt x="drx" y="dry" /></lnTo><lnTo><pt x="dlx" y="dly" /></lnTo><lnTo><pt x="x3" y="y4" /></lnTo><lnTo><pt x="x1" y="y4" /></lnTo><lnTo><pt x="x1" y="y3" /></lnTo><lnTo><pt x="x4" y="y3" /></lnTo><lnTo><pt x="x5" y="y2" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><close /></path></pathLst>';
var Ro = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 23520" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 73490" /><gd name="dx1" fmla="*/ w 73490 200000" /><gd name="dy1" fmla="*/ h 73490 200000" /><gd name="dx2" fmla="*/ ss a1 200000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- hc dx2 0" /><gd name="x4" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y2" fmla="+- vc 0 dx2" /><gd name="y3" fmla="+- vc dx2 0" /><gd name="y4" fmla="+- vc dy1 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="73490"><pos x="l" y="y2" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="x4" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="y4" /></cxn><cxn ang="cd2"><pos x="x1" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="y1" /></cxn></cxnLst><rect l="x1" t="y2" r="x4" b="y3" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y2" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="x3" y="y1" /></lnTo><lnTo><pt x="x3" y="y2" /></lnTo><lnTo><pt x="x4" y="y2" /></lnTo><lnTo><pt x="x4" y="y3" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo><lnTo><pt x="x3" y="y4" /></lnTo><lnTo><pt x="x2" y="y4" /></lnTo><lnTo><pt x="x2" y="y3" /></lnTo><lnTo><pt x="x1" y="y3" /></lnTo><close /></path></pathLst>';
var Yo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 87500" /><gd name="g0" fmla="*/ ss a 100000" /><gd name="g0w" fmla="*/ g0 w ss" /><gd name="g1" fmla="+- ss 0 g0" /><gd name="g2" fmla="*/ g0 g0 g1" /><gd name="g3" fmla="*/ ss ss g1" /><gd name="g4" fmla="*/ g3 2 1" /><gd name="g5" fmla="+- g4 0 g2" /><gd name="g6" fmla="+- g5 0 g0" /><gd name="g6w" fmla="*/ g6 w ss" /><gd name="g7" fmla="*/ g5 1 2" /><gd name="g8" fmla="+- g7 0 g0" /><gd name="dy1" fmla="*/ g8 hd2 ss" /><gd name="g10h" fmla="+- vc 0 dy1" /><gd name="g11h" fmla="+- vc dy1 0" /><gd name="g12" fmla="*/ g0 9598 32768" /><gd name="g12w" fmla="*/ g12 w ss" /><gd name="g13" fmla="+- ss 0 g12" /><gd name="q1" fmla="*/ ss ss 1" /><gd name="q2" fmla="*/ g13 g13 1" /><gd name="q3" fmla="+- q1 0 q2" /><gd name="q4" fmla="sqrt q3" /><gd name="dy4" fmla="*/ q4 hd2 ss" /><gd name="g15h" fmla="+- vc 0 dy4" /><gd name="g16h" fmla="+- vc dy4 0" /><gd name="g17w" fmla="+- g6w 0 g0w" /><gd name="g18w" fmla="*/ g17w 1 2" /><gd name="dx2p" fmla="+- g0w g18w w" /><gd name="dx2" fmla="*/ dx2p -1 1" /><gd name="dy2" fmla="*/ hd2 -1 1" /><gd name="stAng1" fmla="at2 dx2 dy2" /><gd name="enAngp1" fmla="at2 dx2 hd2" /><gd name="enAng1" fmla="+- enAngp1 0 21600000" /><gd name="swAng1" fmla="+- enAng1 0 stAng1" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="87500"><pos x="g0w" y="vc" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="r" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="r" y="b" /></cxn><cxn ang="0"><pos x="g0w" y="vc" /></cxn></cxnLst><rect l="g12w" t="g15h" r="g0w" b="g16h" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="r" y="b" /></moveTo><arcTo wR="w" hR="hd2" stAng="cd4" swAng="cd2" /><arcTo wR="g18w" hR="dy1" stAng="stAng1" swAng="swAng1" /><close /></path></pathLst>';
var Xo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 18750" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="dr" fmla="*/ ss a 100000" /><gd name="iwd2" fmla="+- wd2 0 dr" /><gd name="ihd2" fmla="+- hd2 0 dr" /><gd name="ang" fmla="at2 w h" /><gd name="ct" fmla="cos ihd2 ang" /><gd name="st" fmla="sin iwd2 ang" /><gd name="m" fmla="mod ct st 0" /><gd name="n" fmla="*/ iwd2 ihd2 m" /><gd name="drd2" fmla="*/ dr 1 2" /><gd name="dang" fmla="at2 n drd2" /><gd name="2dang" fmla="*/ dang 2 1" /><gd name="swAng" fmla="+- -10800000 2dang 0" /><gd name="t3" fmla="at2 w h" /><gd name="stAng1" fmla="+- t3 0 dang" /><gd name="stAng2" fmla="+- stAng1 0 cd2" /><gd name="ct1" fmla="cos ihd2 stAng1" /><gd name="st1" fmla="sin iwd2 stAng1" /><gd name="m1" fmla="mod ct1 st1 0" /><gd name="n1" fmla="*/ iwd2 ihd2 m1" /><gd name="dx1" fmla="cos n1 stAng1" /><gd name="dy1" fmla="sin n1 stAng1" /><gd name="x1" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc dy1 0" /><gd name="x2" fmla="+- hc 0 dx1" /><gd name="y2" fmla="+- vc 0 dy1" /><gd name="idx" fmla="cos wd2 2700000" /><gd name="idy" fmla="sin hd2 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="ir" fmla="+- hc idx 0" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ib" fmla="+- vc idy 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefR="adj" minR="0" maxR="50000"><pos x="dr" y="vc" /></ahPolar></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="3cd4"><pos x="il" y="it" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="il" y="ib" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd4"><pos x="ir" y="ib" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="3cd4"><pos x="ir" y="it" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="cd2" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="3cd4" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="0" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="cd4" swAng="cd4" /><close /><moveTo><pt x="x1" y="y1" /></moveTo><arcTo wR="iwd2" hR="ihd2" stAng="stAng1" swAng="swAng" /><close /><moveTo><pt x="x2" y="y2" /></moveTo><arcTo wR="iwd2" hR="ihd2" stAng="stAng2" swAng="swAng" /><close /></path></pathLst>';
var Co = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj" fmla="*/ 50000 w ss" /><gd name="a1" fmla="pin 0 adj1 maxAdj" /><gd name="a2" fmla="pin 0 adj2 maxAdj" /><gd name="x1" fmla="*/ ss a1 200000" /><gd name="x2" fmla="*/ ss a1 100000" /><gd name="dx3" fmla="*/ ss a2 100000" /><gd name="x3" fmla="+- r 0 dx3" /><gd name="x4" fmla="+/ r x3 2" /><gd name="il" fmla="*/ wd3 a1 maxAdj" /><gd name="adjm" fmla="max a1 a2" /><gd name="it" fmla="*/ hd3 adjm maxAdj" /><gd name="irt" fmla="*/ wd3 a2 maxAdj" /><gd name="ir" fmla="+- r 0 irt" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="maxAdj"><pos x="x2" y="t" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="maxAdj"><pos x="x3" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="x4" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="x1" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="x3" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><close /></path></pathLst>';
var Fo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 50000" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 100000 w ss" /><gd name="a1" fmla="pin 0 adj1 100000" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="dx2" fmla="*/ ss a2 100000" /><gd name="x2" fmla="+- r 0 dx2" /><gd name="dy1" fmla="*/ h a1 200000" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y2" fmla="+- vc dy1 0" /><gd name="x1" fmla="*/ dy1 dx2 hd2" /><gd name="x3" fmla="+- r 0 x1" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="100000"><pos x="r" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="maxAdj2"><pos x="x2" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x2" y="t" /></cxn><cxn ang="cd2"><pos x="x1" y="vc" /></cxn><cxn ang="cd4"><pos x="x2" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="x1" t="y1" r="x3" b="y2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y1" /></moveTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="x2" y="b" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="l" y="y2" /></lnTo><lnTo><pt x="x1" y="vc" /></lnTo><close /></path></pathLst>';
var Bo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 29289" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="x1" fmla="*/ ss a 100000" /><gd name="x2" fmla="+- r 0 x1" /><gd name="y2" fmla="+- b 0 x1" /><gd name="il" fmla="*/ x1 1 2" /><gd name="ir" fmla="+- r 0 il" /><gd name="ib" fmla="+- b 0 il" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="50000"><pos x="x1" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="x1" /></cxn><cxn ang="0"><pos x="r" y="y2" /></cxn><cxn ang="cd4"><pos x="x2" y="b" /></cxn><cxn ang="cd4"><pos x="x1" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="y2" /></cxn><cxn ang="cd2"><pos x="l" y="x1" /></cxn><cxn ang="3cd4"><pos x="x1" y="t" /></cxn><cxn ang="3cd4"><pos x="x2" y="t" /></cxn></cxnLst><rect l="il" t="il" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="x1" /></moveTo><lnTo><pt x="x1" y="t" /></lnTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="r" y="x1" /></lnTo><lnTo><pt x="r" y="y2" /></lnTo><lnTo><pt x="x2" y="b" /></lnTo><lnTo><pt x="x1" y="b" /></lnTo><lnTo><pt x="l" y="y2" /></lnTo><close /></path></pathLst>';
var ko = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj" fmla="*/ 100000 w ss" /><gd name="a" fmla="pin 0 adj maxAdj" /><gd name="x1" fmla="*/ ss a 200000" /><gd name="x2" fmla="*/ ss a 100000" /><gd name="x6" fmla="+- r 0 x1" /><gd name="x5" fmla="+- r 0 x2" /><gd name="x3" fmla="*/ x5 1 2" /><gd name="x4" fmla="+- r 0 x3" /><gd name="il" fmla="*/ wd2 a maxAdj" /><gd name="q1" fmla="*/ 5 a maxAdj" /><gd name="q2" fmla="+/ 1 q1 12" /><gd name="il" fmla="*/ q2 w 1" /><gd name="it" fmla="*/ q2 h 1" /><gd name="ir" fmla="+- r 0 il" /><gd name="ib" fmla="+- b 0 it" /><gd name="q3" fmla="*/ h hc x2" /><gd name="y1" fmla="pin 0 q3 h" /><gd name="y2" fmla="+- b 0 y1" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="maxAdj"><pos x="x2" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="y2" /></cxn><cxn ang="3cd4"><pos x="x4" y="t" /></cxn><cxn ang="0"><pos x="x6" y="vc" /></cxn><cxn ang="cd4"><pos x="x3" y="b" /></cxn><cxn ang="cd4"><pos x="hc" y="y1" /></cxn><cxn ang="cd2"><pos x="x1" y="vc" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="x5" y="b" /></lnTo><close /></path></pathLst>';
var qo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="hf" fmla="val 105146" /><gd name="vf" fmla="val 110557" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="swd2" fmla="*/ wd2 hf 100000" /><gd name="shd2" fmla="*/ hd2 vf 100000" /><gd name="svc" fmla="*/ vc  vf 100000" /><gd name="dx1" fmla="cos swd2 1080000" /><gd name="dx2" fmla="cos swd2 18360000" /><gd name="dy1" fmla="sin shd2 1080000" /><gd name="dy2" fmla="sin shd2 18360000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- hc dx2 0" /><gd name="x4" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- svc 0 dy1" /><gd name="y2" fmla="+- svc 0 dy2" /><gd name="it" fmla="*/ y1 dx2 dx1" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="x1" y="y1" /></cxn><cxn ang="cd4"><pos x="x2" y="y2" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd4"><pos x="x3" y="y2" /></cxn><cxn ang="0"><pos x="x4" y="y1" /></cxn></cxnLst><rect l="x2" t="it" r="x3" b="y2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="x4" y="y1" /></lnTo><lnTo><pt x="x3" y="y2" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><close /></path></pathLst>';
var Mo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 0" /><gd name="adj2" fmla="val 16200000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="stAng" fmla="pin 0 adj1 21599999" /><gd name="enAng" fmla="pin 0 adj2 21599999" /><gd name="sw1" fmla="+- enAng 0 stAng" /><gd name="sw2" fmla="+- sw1 21600000 0" /><gd name="swAng" fmla="?: sw1 sw1 sw2" /><gd name="wt1" fmla="sin wd2 stAng" /><gd name="ht1" fmla="cos hd2 stAng" /><gd name="dx1" fmla="cat2 wd2 ht1 wt1" /><gd name="dy1" fmla="sat2 hd2 ht1 wt1" /><gd name="x1" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc dy1 0" /><gd name="wt2" fmla="sin wd2 enAng" /><gd name="ht2" fmla="cos hd2 enAng" /><gd name="dx2" fmla="cat2 wd2 ht2 wt2" /><gd name="dy2" fmla="sat2 hd2 ht2 wt2" /><gd name="x2" fmla="+- hc dx2 0" /><gd name="y2" fmla="+- vc dy2 0" /><gd name="idx" fmla="cos wd2 2700000" /><gd name="idy" fmla="sin hd2 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="ir" fmla="+- hc idx 0" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ib" fmla="+- vc idy 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefAng="adj1" minAng="0" maxAng="21599999"><pos x="x1" y="y1" /></ahPolar><ahPolar gdRefAng="adj2" minAng="0" maxAng="21599999"><pos x="x2" y="y2" /></ahPolar></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="il" t="ir" r="it" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y1" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="stAng" swAng="swAng" /><lnTo><pt x="hc" y="vc" /></lnTo><close /></path></pathLst>';
var Po = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="g1" fmla="cos w 13500000" /><gd name="g2" fmla="sin h 13500000" /><gd name="x1" fmla="+- r g1 0" /><gd name="y1" fmla="+- b g2 0" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn></cxnLst><rect l="x1" t="y1" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="b" /></moveTo><arcTo wR="w" hR="h" stAng="cd2" swAng="cd4" /><lnTo><pt x="r" y="b" /></lnTo><close /></path></pathLst>';
var So = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 16667" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="x1" fmla="*/ ss a 100000" /><gd name="x2" fmla="+- r 0 x1" /><gd name="y2" fmla="+- b 0 x1" /><gd name="il" fmla="*/ x1 70711 100000" /><gd name="ir" fmla="+- r 0 il" /><gd name="ib" fmla="+- b 0 il" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="50000"><pos x="x1" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="il" t="il" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="x1" /></moveTo><arcTo wR="x1" hR="x1" stAng="cd4" swAng="-5400000" /><lnTo><pt x="x2" y="t" /></lnTo><arcTo wR="x1" hR="x1" stAng="cd2" swAng="-5400000" /><lnTo><pt x="r" y="y2" /></lnTo><arcTo wR="x1" hR="x1" stAng="3cd4" swAng="-5400000" /><lnTo><pt x="x1" y="b" /></lnTo><arcTo wR="x1" hR="x1" stAng="0" swAng="-5400000" /><close /></path></pathLst>';
var Oo = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="md" fmla="mod w h 0" /><gd name="dx" fmla="*/ 1 md 20" /><gd name="y1" fmla="+- 0 b dx" /><gd name="x1" fmla="+- 0 r dx" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd2"><pos x="l" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="dx" /></cxn><cxn ang="cd2"><pos x="l" y="y1" /></cxn><cxn ang="cd2"><pos x="l" y="b" /></cxn><cxn ang="3cd4"><pos x="dx" y="t" /></cxn><cxn ang="3cd4"><pos x="x1" y="t" /></cxn><cxn ang="cd4"><pos x="dx" y="b" /></cxn><cxn ang="cd4"><pos x="x1" y="b" /></cxn><cxn ang="0"><pos x="r" y="t" /></cxn><cxn ang="0"><pos x="r" y="dx" /></cxn><cxn ang="0"><pos x="r" y="y1" /></cxn><cxn ang="0"><pos x="r" y="b" /></cxn></cxnLst><rect l="dx" t="dx" r="x1" b="y1" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="dx" y="t" /></lnTo><arcTo wR="dx" hR="dx" stAng="0" swAng="cd4" /><close /></path><path><moveTo><pt x="l" y="y1" /></moveTo><arcTo wR="dx" hR="dx" stAng="3cd4" swAng="cd4" /><lnTo><pt x="l" y="b" /></lnTo><close /></path><path><moveTo><pt x="r" y="t" /></moveTo><lnTo><pt x="r" y="dx" /></lnTo><arcTo wR="dx" hR="dx" stAng="cd4" swAng="cd4" /><close /></path><path><moveTo><pt x="x1" y="b" /></moveTo><arcTo wR="dx" hR="dx" stAng="cd2" swAng="cd4" /><lnTo><pt x="r" y="b" /></lnTo><close /></path></pathLst>';
var Io = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="x1" fmla="*/ ss a 100000" /><gd name="x2" fmla="+- r 0 x1" /><gd name="y2" fmla="+- b 0 x1" /><gd name="d" fmla="+- w 0 h" /><gd name="il" fmla="?: d l x1" /><gd name="ir" fmla="?: d r x2" /><gd name="it" fmla="?: d x1 t" /><gd name="ib" fmla="?: d y2 b" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="50000"><pos x="x1" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="x1" /></moveTo><lnTo><pt x="x1" y="x1" /></lnTo><lnTo><pt x="x1" y="t" /></lnTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="x2" y="x1" /></lnTo><lnTo><pt x="r" y="x1" /></lnTo><lnTo><pt x="r" y="y2" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x2" y="b" /></lnTo><lnTo><pt x="x1" y="b" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><lnTo><pt x="l" y="y2" /></lnTo><close /></path></pathLst>';
var Do = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 22500" /><gd name="adj2" fmla="val 22500" /><gd name="adj3" fmla="val 22500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a2" fmla="pin 0 adj2 50000" /><gd name="maxAdj1" fmla="*/ a2 2 1" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="q1" fmla="+- 100000 0 maxAdj1" /><gd name="maxAdj3" fmla="*/ q1 1 2" /><gd name="a3" fmla="pin 0 adj3 maxAdj3" /><gd name="x1" fmla="*/ ss a3 100000" /><gd name="dx2" fmla="*/ ss a2 100000" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x5" fmla="+- hc dx2 0" /><gd name="dx3" fmla="*/ ss a1 200000" /><gd name="x3" fmla="+- hc 0 dx3" /><gd name="x4" fmla="+- hc dx3 0" /><gd name="x6" fmla="+- r 0 x1" /><gd name="y2" fmla="+- vc 0 dx2" /><gd name="y5" fmla="+- vc dx2 0" /><gd name="y3" fmla="+- vc 0 dx3" /><gd name="y4" fmla="+- vc dx3 0" /><gd name="y6" fmla="+- b 0 x1" /><gd name="il" fmla="*/ dx3 x1 dx2" /><gd name="ir" fmla="+- r 0 il" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="maxAdj1"><pos x="x3" y="x1" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="50000"><pos x="x2" y="t" /></ahXY><ahXY gdRefY="adj3" minY="0" maxY="maxAdj3"><pos x="r" y="x1" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="il" t="y3" r="ir" b="y4" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="x1" y="y2" /></lnTo><lnTo><pt x="x1" y="y3" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo><lnTo><pt x="x3" y="x1" /></lnTo><lnTo><pt x="x2" y="x1" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="x5" y="x1" /></lnTo><lnTo><pt x="x4" y="x1" /></lnTo><lnTo><pt x="x4" y="y3" /></lnTo><lnTo><pt x="x6" y="y3" /></lnTo><lnTo><pt x="x6" y="y2" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="x6" y="y5" /></lnTo><lnTo><pt x="x6" y="y4" /></lnTo><lnTo><pt x="x4" y="y4" /></lnTo><lnTo><pt x="x4" y="y6" /></lnTo><lnTo><pt x="x5" y="y6" /></lnTo><lnTo><pt x="hc" y="b" /></lnTo><lnTo><pt x="x2" y="y6" /></lnTo><lnTo><pt x="x3" y="y6" /></lnTo><lnTo><pt x="x3" y="y4" /></lnTo><lnTo><pt x="x1" y="y4" /></lnTo><lnTo><pt x="x1" y="y5" /></lnTo><close /></path></pathLst>';
var Eo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 18515" /><gd name="adj2" fmla="val 18515" /><gd name="adj3" fmla="val 18515" /><gd name="adj4" fmla="val 48123" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a2" fmla="pin 0 adj2 50000" /><gd name="maxAdj1" fmla="*/ a2 2 1" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="maxAdj3" fmla="+- 50000 0 a2" /><gd name="a3" fmla="pin 0 adj3 maxAdj3" /><gd name="q2" fmla="*/ a3 2 1" /><gd name="maxAdj4" fmla="+- 100000 0 q2" /><gd name="a4" fmla="pin a1 adj4 maxAdj4" /><gd name="dx2" fmla="*/ ss a2 100000" /><gd name="dx3" fmla="*/ ss a1 200000" /><gd name="ah" fmla="*/ ss a3 100000" /><gd name="dx1" fmla="*/ w a4 200000" /><gd name="dy1" fmla="*/ h a4 200000" /><gd name="x8" fmla="+- r 0 ah" /><gd name="x2" fmla="+- hc 0 dx1" /><gd name="x7" fmla="+- hc dx1 0" /><gd name="x3" fmla="+- hc 0 dx2" /><gd name="x6" fmla="+- hc dx2 0" /><gd name="x4" fmla="+- hc 0 dx3" /><gd name="x5" fmla="+- hc dx3 0" /><gd name="y8" fmla="+- b 0 ah" /><gd name="y2" fmla="+- vc 0 dy1" /><gd name="y7" fmla="+- vc dy1 0" /><gd name="y3" fmla="+- vc 0 dx2" /><gd name="y6" fmla="+- vc dx2 0" /><gd name="y4" fmla="+- vc 0 dx3" /><gd name="y5" fmla="+- vc dx3 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="maxAdj1"><pos x="x4" y="ah" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="50000"><pos x="x3" y="t" /></ahXY><ahXY gdRefY="adj3" minY="0" maxY="maxAdj3"><pos x="r" y="ah" /></ahXY><ahXY gdRefY="adj4" minY="a1" maxY="maxAdj4"><pos x="l" y="y2" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="x2" t="y2" r="x7" b="y7" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="ah" y="y3" /></lnTo><lnTo><pt x="ah" y="y4" /></lnTo><lnTo><pt x="x2" y="y4" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x4" y="y2" /></lnTo><lnTo><pt x="x4" y="ah" /></lnTo><lnTo><pt x="x3" y="ah" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="x6" y="ah" /></lnTo><lnTo><pt x="x5" y="ah" /></lnTo><lnTo><pt x="x5" y="y2" /></lnTo><lnTo><pt x="x7" y="y2" /></lnTo><lnTo><pt x="x7" y="y4" /></lnTo><lnTo><pt x="x8" y="y4" /></lnTo><lnTo><pt x="x8" y="y3" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="x8" y="y6" /></lnTo><lnTo><pt x="x8" y="y5" /></lnTo><lnTo><pt x="x7" y="y5" /></lnTo><lnTo><pt x="x7" y="y7" /></lnTo><lnTo><pt x="x5" y="y7" /></lnTo><lnTo><pt x="x5" y="y8" /></lnTo><lnTo><pt x="x6" y="y8" /></lnTo><lnTo><pt x="hc" y="b" /></lnTo><lnTo><pt x="x3" y="y8" /></lnTo><lnTo><pt x="x4" y="y8" /></lnTo><lnTo><pt x="x4" y="y7" /></lnTo><lnTo><pt x="x2" y="y7" /></lnTo><lnTo><pt x="x2" y="y5" /></lnTo><lnTo><pt x="ah" y="y5" /></lnTo><lnTo><pt x="ah" y="y6" /></lnTo><close /></path></pathLst>';
var zo = '<cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var Go = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 16667" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 33333" /><gd name="a2" fmla="pin 25000 adj2 75000" /><gd name="x10" fmla="+- r 0 wd8" /><gd name="dx2" fmla="*/ w a2 200000" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x9" fmla="+- hc dx2 0" /><gd name="x3" fmla="+- x2 wd32 0" /><gd name="x8" fmla="+- x9 0 wd32" /><gd name="x5" fmla="+- x2 wd8 0" /><gd name="x6" fmla="+- x9 0 wd8" /><gd name="x4" fmla="+- x5 0 wd32" /><gd name="x7" fmla="+- x6 wd32 0" /><gd name="y1" fmla="*/ h a1 200000" /><gd name="y2" fmla="*/ h a1 100000" /><gd name="y4" fmla="+- b 0 y2" /><gd name="y3" fmla="*/ y4 1 2" /><gd name="hR" fmla="*/ h a1 400000" /><gd name="y5" fmla="+- b 0 hR" /><gd name="y6" fmla="+- y2 0 hR" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="33333"><pos x="hc" y="y2" /></ahXY><ahXY gdRefX="adj2" minX="25000" maxX="75000"><pos x="x2" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="y2" /></cxn><cxn ang="cd2"><pos x="wd8" y="y3" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="x10" y="y3" /></cxn></cxnLst><rect l="x2" t="y2" r="x9" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="x4" y="t" /></lnTo><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="cd2" /><lnTo><pt x="x3" y="y1" /></lnTo><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="-10800000" /><lnTo><pt x="x8" y="y2" /></lnTo><arcTo wR="wd32" hR="hR" stAng="cd4" swAng="-10800000" /><lnTo><pt x="x7" y="y1" /></lnTo><arcTo wR="wd32" hR="hR" stAng="cd4" swAng="cd2" /><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="x10" y="y3" /></lnTo><lnTo><pt x="r" y="y4" /></lnTo><lnTo><pt x="x9" y="y4" /></lnTo><lnTo><pt x="x9" y="y5" /></lnTo><arcTo wR="wd32" hR="hR" stAng="0" swAng="cd4" /><lnTo><pt x="x3" y="b" /></lnTo><arcTo wR="wd32" hR="hR" stAng="cd4" swAng="cd4" /><lnTo><pt x="x2" y="y4" /></lnTo><lnTo><pt x="l" y="y4" /></lnTo><lnTo><pt x="wd8" y="y3" /></lnTo><close /></path><path stroke="false" fill="darkenLess" extrusionOk="false"><moveTo><pt x="x5" y="hR" /></moveTo><arcTo wR="wd32" hR="hR" stAng="0" swAng="cd4" /><lnTo><pt x="x3" y="y1" /></lnTo><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="-10800000" /><lnTo><pt x="x5" y="y2" /></lnTo><close /><moveTo><pt x="x6" y="hR" /></moveTo><arcTo wR="wd32" hR="hR" stAng="cd2" swAng="-5400000" /><lnTo><pt x="x8" y="y1" /></lnTo><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="cd2" /><lnTo><pt x="x6" y="y2" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="x4" y="t" /></lnTo><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="cd2" /><lnTo><pt x="x3" y="y1" /></lnTo><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="-10800000" /><lnTo><pt x="x8" y="y2" /></lnTo><arcTo wR="wd32" hR="hR" stAng="cd4" swAng="-10800000" /><lnTo><pt x="x7" y="y1" /></lnTo><arcTo wR="wd32" hR="hR" stAng="cd4" swAng="cd2" /><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="x10" y="y3" /></lnTo><lnTo><pt x="r" y="y4" /></lnTo><lnTo><pt x="x9" y="y4" /></lnTo><lnTo><pt x="x9" y="y5" /></lnTo><arcTo wR="wd32" hR="hR" stAng="0" swAng="cd4" /><lnTo><pt x="x3" y="b" /></lnTo><arcTo wR="wd32" hR="hR" stAng="cd4" swAng="cd4" /><lnTo><pt x="x2" y="y4" /></lnTo><lnTo><pt x="l" y="y4" /></lnTo><lnTo><pt x="wd8" y="y3" /></lnTo><close /><moveTo><pt x="x5" y="hR" /></moveTo><lnTo><pt x="x5" y="y2" /></lnTo><moveTo><pt x="x6" y="y2" /></moveTo><lnTo><pt x="x6" y="hR" /></lnTo><moveTo><pt x="x2" y="y4" /></moveTo><lnTo><pt x="x2" y="y6" /></lnTo><moveTo><pt x="x9" y="y6" /></moveTo><lnTo><pt x="x9" y="y4" /></lnTo></path></pathLst>';
var Ho = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 16667" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 33333" /><gd name="a2" fmla="pin 25000 adj2 75000" /><gd name="x10" fmla="+- r 0 wd8" /><gd name="dx2" fmla="*/ w a2 200000" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x9" fmla="+- hc dx2 0" /><gd name="x3" fmla="+- x2 wd32 0" /><gd name="x8" fmla="+- x9 0 wd32" /><gd name="x5" fmla="+- x2 wd8 0" /><gd name="x6" fmla="+- x9 0 wd8" /><gd name="x4" fmla="+- x5 0 wd32" /><gd name="x7" fmla="+- x6 wd32 0" /><gd name="dy1" fmla="*/ h a1 200000" /><gd name="y1" fmla="+- b 0 dy1" /><gd name="dy2" fmla="*/ h a1 100000" /><gd name="y2" fmla="+- b 0 dy2" /><gd name="y4" fmla="+- t dy2 0" /><gd name="y3" fmla="+/ y4 b 2" /><gd name="hR" fmla="*/ h a1 400000" /><gd name="y6" fmla="+- b 0 hR" /><gd name="y7" fmla="+- y1 0 hR" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="33333"><pos x="hc" y="y2" /></ahXY><ahXY gdRefX="adj2" minX="25000" maxX="75000"><pos x="x2" y="b" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="wd8" y="y3" /></cxn><cxn ang="cd4"><pos x="hc" y="y2" /></cxn><cxn ang="0"><pos x="x10" y="y3" /></cxn></cxnLst><rect l="x2" t="t" r="x9" b="y2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="x4" y="b" /></lnTo><arcTo wR="wd32" hR="hR" stAng="cd4" swAng="-10800000" /><lnTo><pt x="x3" y="y1" /></lnTo><arcTo wR="wd32" hR="hR" stAng="cd4" swAng="cd2" /><lnTo><pt x="x8" y="y2" /></lnTo><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="cd2" /><lnTo><pt x="x7" y="y1" /></lnTo><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="-10800000" /><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="x10" y="y3" /></lnTo><lnTo><pt x="r" y="y4" /></lnTo><lnTo><pt x="x9" y="y4" /></lnTo><lnTo><pt x="x9" y="hR" /></lnTo><arcTo wR="wd32" hR="hR" stAng="0" swAng="-5400000" /><lnTo><pt x="x3" y="t" /></lnTo><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="-5400000" /><lnTo><pt x="x2" y="y4" /></lnTo><lnTo><pt x="l" y="y4" /></lnTo><lnTo><pt x="wd8" y="y3" /></lnTo><close /></path><path stroke="false" fill="darkenLess" extrusionOk="false"><moveTo><pt x="x5" y="y6" /></moveTo><arcTo wR="wd32" hR="hR" stAng="0" swAng="-5400000" /><lnTo><pt x="x3" y="y1" /></lnTo><arcTo wR="wd32" hR="hR" stAng="cd4" swAng="cd2" /><lnTo><pt x="x5" y="y2" /></lnTo><close /><moveTo><pt x="x6" y="y6" /></moveTo><arcTo wR="wd32" hR="hR" stAng="cd2" swAng="cd4" /><lnTo><pt x="x8" y="y1" /></lnTo><arcTo wR="wd32" hR="hR" stAng="cd4" swAng="-10800000" /><lnTo><pt x="x6" y="y2" /></lnTo><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="wd8" y="y3" /></lnTo><lnTo><pt x="l" y="y4" /></lnTo><lnTo><pt x="x2" y="y4" /></lnTo><lnTo><pt x="x2" y="hR" /></lnTo><arcTo wR="wd32" hR="hR" stAng="cd2" swAng="cd4" /><lnTo><pt x="x8" y="t" /></lnTo><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="cd4" /><lnTo><pt x="x9" y="y4" /></lnTo><lnTo><pt x="x9" y="y4" /></lnTo><lnTo><pt x="r" y="y4" /></lnTo><lnTo><pt x="x10" y="y3" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="x7" y="b" /></lnTo><arcTo wR="wd32" hR="hR" stAng="cd4" swAng="cd2" /><lnTo><pt x="x8" y="y1" /></lnTo><arcTo wR="wd32" hR="hR" stAng="cd4" swAng="-10800000" /><lnTo><pt x="x3" y="y2" /></lnTo><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="-10800000" /><lnTo><pt x="x4" y="y1" /></lnTo><arcTo wR="wd32" hR="hR" stAng="3cd4" swAng="cd2" /><close /><moveTo><pt x="x5" y="y2" /></moveTo><lnTo><pt x="x5" y="y6" /></lnTo><moveTo><pt x="x6" y="y6" /></moveTo><lnTo><pt x="x6" y="y2" /></lnTo><moveTo><pt x="x2" y="y7" /></moveTo><lnTo><pt x="x2" y="y4" /></lnTo><moveTo><pt x="x9" y="y4" /></moveTo><lnTo><pt x="x9" y="y7" /></lnTo></path></pathLst>';
var No = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 50000" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 100000 w ss" /><gd name="a1" fmla="pin 0 adj1 100000" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="dx1" fmla="*/ ss a2 100000" /><gd name="x1" fmla="+- r 0 dx1" /><gd name="dy1" fmla="*/ h a1 200000" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y2" fmla="+- vc dy1 0" /><gd name="dx2" fmla="*/ y1 dx1 hd2" /><gd name="x2" fmla="+- x1 dx2 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="100000"><pos x="l" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="maxAdj2"><pos x="x1" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x1" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="x1" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="y1" r="x2" b="y2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y1" /></moveTo><lnTo><pt x="x1" y="y1" /></lnTo><lnTo><pt x="x1" y="t" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="x1" y="b" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><lnTo><pt x="l" y="y2" /></lnTo><close /></path></pathLst>';
var Zo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 25000" /><gd name="adj3" fmla="val 25000" /><gd name="adj4" fmla="val 64977" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 50000 h ss" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="maxAdj1" fmla="*/ a2 2 1" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="maxAdj3" fmla="*/ 100000 w ss" /><gd name="a3" fmla="pin 0 adj3 maxAdj3" /><gd name="q2" fmla="*/ a3 ss w" /><gd name="maxAdj4" fmla="+- 100000 0 q2" /><gd name="a4" fmla="pin 0 adj4 maxAdj4" /><gd name="dy1" fmla="*/ ss a2 100000" /><gd name="dy2" fmla="*/ ss a1 200000" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y2" fmla="+- vc 0 dy2" /><gd name="y3" fmla="+- vc dy2 0" /><gd name="y4" fmla="+- vc dy1 0" /><gd name="dx3" fmla="*/ ss a3 100000" /><gd name="x3" fmla="+- r 0 dx3" /><gd name="x2" fmla="*/ w a4 100000" /><gd name="x1" fmla="*/ x2 1 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="maxAdj1"><pos x="x3" y="y2" /></ahXY><ahXY gdRefY="adj2" minY="0" maxY="maxAdj2"><pos x="r" y="y1" /></ahXY><ahXY gdRefX="adj3" minX="0" maxX="maxAdj3"><pos x="x3" y="t" /></ahXY><ahXY gdRefX="adj4" minX="0" maxX="maxAdj4"><pos x="x2" y="b" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x1" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="x1" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="t" r="x2" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x3" y="y2" /></lnTo><lnTo><pt x="x3" y="y1" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="x3" y="y4" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo><lnTo><pt x="x2" y="y3" /></lnTo><lnTo><pt x="x2" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var _o = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 8333" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a2" fmla="pin 0 adj2 100000" /><gd name="q1" fmla="+- 100000 0 a2" /><gd name="q2" fmla="min q1 a2" /><gd name="q3" fmla="*/ q2 1 2" /><gd name="maxAdj1" fmla="*/ q3 h ss" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="y1" fmla="*/ ss a1 100000" /><gd name="y3" fmla="*/ h a2 100000" /><gd name="y2" fmla="+- y3 0 y1" /><gd name="y4" fmla="+- b 0 y1" /><gd name="dx1" fmla="cos wd2 2700000" /><gd name="dy1" fmla="sin y1 2700000" /><gd name="ir" fmla="+- l dx1 0" /><gd name="it" fmla="+- y1 0 dy1" /><gd name="ib" fmla="+- b dy1 y1" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="maxAdj1"><pos x="hc" y="y1" /></ahXY><ahXY gdRefY="adj2" minY="0" maxY="100000"><pos x="r" y="y3" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd4"><pos x="l" y="t" /></cxn><cxn ang="cd2"><pos x="r" y="y3" /></cxn><cxn ang="3cd4"><pos x="l" y="b" /></cxn></cxnLst><rect l="l" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><arcTo wR="wd2" hR="y1" stAng="3cd4" swAng="cd4" /><lnTo><pt x="hc" y="y2" /></lnTo><arcTo wR="wd2" hR="y1" stAng="cd2" swAng="-5400000" /><arcTo wR="wd2" hR="y1" stAng="3cd4" swAng="-5400000" /><lnTo><pt x="hc" y="y4" /></lnTo><arcTo wR="wd2" hR="y1" stAng="0" swAng="cd4" /><close /></path><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><arcTo wR="wd2" hR="y1" stAng="3cd4" swAng="cd4" /><lnTo><pt x="hc" y="y2" /></lnTo><arcTo wR="wd2" hR="y1" stAng="cd2" swAng="-5400000" /><arcTo wR="wd2" hR="y1" stAng="3cd4" swAng="-5400000" /><lnTo><pt x="hc" y="y4" /></lnTo><arcTo wR="wd2" hR="y1" stAng="0" swAng="cd4" /></path></pathLst>';
var Vo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 8333" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj" fmla="*/ 50000 h ss" /><gd name="a" fmla="pin 0 adj maxAdj" /><gd name="y1" fmla="*/ ss a 100000" /><gd name="y2" fmla="+- b 0 y1" /><gd name="dx1" fmla="cos w 2700000" /><gd name="dy1" fmla="sin y1 2700000" /><gd name="ir" fmla="+- l dx1 0" /><gd name="it" fmla="+- y1 0 dy1" /><gd name="ib" fmla="+- b dy1 y1" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="maxAdj"><pos x="r" y="y1" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd4"><pos x="l" y="t" /></cxn><cxn ang="3cd4"><pos x="l" y="b" /></cxn><cxn ang="cd2"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="t" /></moveTo><arcTo wR="w" hR="y1" stAng="3cd4" swAng="cd4" /><lnTo><pt x="r" y="y2" /></lnTo><arcTo wR="w" hR="y1" stAng="0" swAng="cd4" /><close /></path><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><arcTo wR="w" hR="y1" stAng="3cd4" swAng="cd4" /><lnTo><pt x="r" y="y2" /></lnTo><arcTo wR="w" hR="y1" stAng="0" swAng="cd4" /></path></pathLst>';
var Wo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 16667" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="dx1" fmla="*/ ss a 100000" /><gd name="x1" fmla="+- r 0 dx1" /><gd name="idx" fmla="*/ dx1 29289 100000" /><gd name="ir" fmla="+- r 0 idx" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="50000"><pos x="x1" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="t" r="ir" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="x1" y="t" /></lnTo><arcTo wR="dx1" hR="dx1" stAng="3cd4" swAng="cd4" /><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var Qo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 16667" /><gd name="adj2" fmla="val 0" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 50000" /><gd name="a2" fmla="pin 0 adj2 50000" /><gd name="x1" fmla="*/ ss a1 100000" /><gd name="y1" fmla="+- b 0 x1" /><gd name="a" fmla="*/ ss a2 100000" /><gd name="x2" fmla="+- r 0 a" /><gd name="y2" fmla="+- b 0 a" /><gd name="dx1" fmla="*/ x1 29289 100000" /><gd name="dx2" fmla="*/ a 29289 100000" /><gd name="d" fmla="+- dx1 0 dx2" /><gd name="dx" fmla="?: d dx1 dx2" /><gd name="ir" fmla="+- r 0 dx" /><gd name="ib" fmla="+- b 0 dx" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="50000"><pos x="x1" y="t" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="50000"><pos x="x2" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="dx" t="dx" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="t" /></moveTo><lnTo><pt x="x2" y="t" /></lnTo><arcTo wR="a" hR="a" stAng="3cd4" swAng="cd4" /><lnTo><pt x="r" y="y1" /></lnTo><arcTo wR="x1" hR="x1" stAng="0" swAng="cd4" /><lnTo><pt x="a" y="b" /></lnTo><arcTo wR="a" hR="a" stAng="cd4" swAng="cd4" /><lnTo><pt x="l" y="x1" /></lnTo><arcTo wR="x1" hR="x1" stAng="cd2" swAng="cd4" /><close /></path></pathLst>';
var Uo = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 16667" /><gd name="adj2" fmla="val 0" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 50000" /><gd name="a2" fmla="pin 0 adj2 50000" /><gd name="tx1" fmla="*/ ss a1 100000" /><gd name="tx2" fmla="+- r 0 tx1" /><gd name="bx1" fmla="*/ ss a2 100000" /><gd name="bx2" fmla="+- r 0 bx1" /><gd name="by1" fmla="+- b 0 bx1" /><gd name="d" fmla="+- tx1 0 bx1" /><gd name="tdx" fmla="*/ tx1 29289 100000" /><gd name="bdx" fmla="*/ bx1 29289 100000" /><gd name="il" fmla="?: d tdx bdx" /><gd name="ir" fmla="+- r 0 il" /><gd name="ib" fmla="+- b 0 bdx" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="50000"><pos x="tx2" y="t" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="50000"><pos x="bx1" y="b" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="il" t="tdx" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="tx1" y="t" /></moveTo><lnTo><pt x="tx2" y="t" /></lnTo><arcTo wR="tx1" hR="tx1" stAng="3cd4" swAng="cd4" /><lnTo><pt x="r" y="by1" /></lnTo><arcTo wR="bx1" hR="bx1" stAng="0" swAng="cd4" /><lnTo><pt x="bx1" y="b" /></lnTo><arcTo wR="bx1" hR="bx1" stAng="cd4" swAng="cd4" /><lnTo><pt x="l" y="tx1" /></lnTo><arcTo wR="tx1" hR="tx1" stAng="cd2" swAng="cd4" /><close /></path></pathLst>';
var Ko = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 16667" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="x1" fmla="*/ ss a 100000" /><gd name="x2" fmla="+- r 0 x1" /><gd name="y2" fmla="+- b 0 x1" /><gd name="il" fmla="*/ x1 29289 100000" /><gd name="ir" fmla="+- r 0 il" /><gd name="ib" fmla="+- b 0 il" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="50000"><pos x="x1" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="il" t="il" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="x1" /></moveTo><arcTo wR="x1" hR="x1" stAng="cd2" swAng="cd4" /><lnTo><pt x="x2" y="t" /></lnTo><arcTo wR="x1" hR="x1" stAng="3cd4" swAng="cd4" /><lnTo><pt x="r" y="y2" /></lnTo><arcTo wR="x1" hR="x1" stAng="0" swAng="cd4" /><lnTo><pt x="x1" y="b" /></lnTo><arcTo wR="x1" hR="x1" stAng="cd4" swAng="cd4" /><close /></path></pathLst>';
var Jo = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="it" fmla="*/ h 7 12" /><gd name="ir" fmla="*/ w 7 12" /><gd name="ib" fmla="*/ h 11 12" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="l" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="l" y="b" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd4"><pos x="r" y="b" /></cxn><cxn ang="0"><pos x="hc" y="vc" /></cxn></cxnLst><rect l="wd12" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="l" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><close /></path></pathLst>';
var al = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 4653" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin -4653 adj 4653" /><gd name="x1" fmla="*/ w 4969 21699" /><gd name="x2" fmla="*/ w 6215 21600" /><gd name="x3" fmla="*/ w 13135 21600" /><gd name="x4" fmla="*/ w 16640 21600" /><gd name="y1" fmla="*/ h 7570 21600" /><gd name="y3" fmla="*/ h 16515 21600" /><gd name="dy2" fmla="*/ h a 100000" /><gd name="y2" fmla="+- y3 0 dy2" /><gd name="y4" fmla="+- y3 dy2 0" /><gd name="dy3" fmla="*/ h a 50000" /><gd name="y5" fmla="+- y4 dy3 0" /><gd name="idx" fmla="cos wd2 2700000" /><gd name="idy" fmla="sin hd2 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="ir" fmla="+- hc idx 0" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ib" fmla="+- vc idy 0" /><gd name="wR" fmla="*/ w 1125 21600" /><gd name="hR" fmla="*/ h 1125 21600" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="-4653" maxY="4653"><pos x="hc" y="y4" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="3cd4"><pos x="il" y="it" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="il" y="ib" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd4"><pos x="ir" y="ib" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="3cd4"><pos x="ir" y="it" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="l" y="vc" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="cd2" swAng="21600000" /><close /></path><path fill="darkenLess" extrusionOk="false"><moveTo><pt x="x2" y="y1" /></moveTo><arcTo wR="wR" hR="hR" stAng="cd2" swAng="21600000" /><moveTo><pt x="x3" y="y1" /></moveTo><arcTo wR="wR" hR="hR" stAng="cd2" swAng="21600000" /></path><path fill="none" extrusionOk="false"><moveTo><pt x="x1" y="y2" /></moveTo><quadBezTo><pt x="hc" y="y5" /><pt x="x4" y="y2" /></quadBezTo></path><path fill="none"><moveTo><pt x="l" y="vc" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="cd2" swAng="21600000" /><close /></path></pathLst>';
var nl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 16667" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="dx1" fmla="*/ ss a 100000" /><gd name="x1" fmla="+- r 0 dx1" /><gd name="it" fmla="*/ dx1 1 2" /><gd name="ir" fmla="+/ x1 r 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="50000"><pos x="x1" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="l" t="it" r="ir" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="x1" y="t" /></lnTo><lnTo><pt x="r" y="dx1" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var ml = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 0" /><gd name="adj2" fmla="val 16667" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 50000" /><gd name="a2" fmla="pin 0 adj2 50000" /><gd name="lx1" fmla="*/ ss a1 100000" /><gd name="lx2" fmla="+- r 0 lx1" /><gd name="ly1" fmla="+- b 0 lx1" /><gd name="rx1" fmla="*/ ss a2 100000" /><gd name="rx2" fmla="+- r 0 rx1" /><gd name="ry1" fmla="+- b 0 rx1" /><gd name="d" fmla="+- lx1 0 rx1" /><gd name="dx" fmla="?: d lx1 rx1" /><gd name="il" fmla="*/ dx 1 2" /><gd name="ir" fmla="+- r 0 il" /><gd name="ib" fmla="+- b 0 il" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="50000"><pos x="lx1" y="t" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="50000"><pos x="rx2" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="il" t="il" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="lx1" y="t" /></moveTo><lnTo><pt x="rx2" y="t" /></lnTo><lnTo><pt x="r" y="rx1" /></lnTo><lnTo><pt x="r" y="ly1" /></lnTo><lnTo><pt x="lx2" y="b" /></lnTo><lnTo><pt x="rx1" y="b" /></lnTo><lnTo><pt x="l" y="ry1" /></lnTo><lnTo><pt x="l" y="lx1" /></lnTo><close /></path></pathLst>';
var tl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 16667" /><gd name="adj2" fmla="val 0" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 50000" /><gd name="a2" fmla="pin 0 adj2 50000" /><gd name="tx1" fmla="*/ ss a1 100000" /><gd name="tx2" fmla="+- r 0 tx1" /><gd name="bx1" fmla="*/ ss a2 100000" /><gd name="bx2" fmla="+- r 0 bx1" /><gd name="by1" fmla="+- b 0 bx1" /><gd name="d" fmla="+- tx1 0 bx1" /><gd name="dx" fmla="?: d tx1 bx1" /><gd name="il" fmla="*/ dx 1 2" /><gd name="ir" fmla="+- r 0 il" /><gd name="it" fmla="*/ tx1 1 2" /><gd name="ib" fmla="+/ by1 b 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="50000"><pos x="tx2" y="t" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="50000"><pos x="bx1" y="b" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="tx1" y="t" /></moveTo><lnTo><pt x="tx2" y="t" /></lnTo><lnTo><pt x="r" y="tx1" /></lnTo><lnTo><pt x="r" y="by1" /></lnTo><lnTo><pt x="bx2" y="b" /></lnTo><lnTo><pt x="bx1" y="b" /></lnTo><lnTo><pt x="l" y="by1" /></lnTo><lnTo><pt x="l" y="tx1" /></lnTo><close /></path></pathLst>';
var ol = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 16667" /><gd name="adj2" fmla="val 16667" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 50000" /><gd name="a2" fmla="pin 0 adj2 50000" /><gd name="x1" fmla="*/ ss a1 100000" /><gd name="dx2" fmla="*/ ss a2 100000" /><gd name="x2" fmla="+- r 0 dx2" /><gd name="il" fmla="*/ x1 29289 100000" /><gd name="ir" fmla="+/ x2 r 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="50000"><pos x="x1" y="t" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="50000"><pos x="x2" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="il" t="il" r="ir" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="t" /></moveTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="r" y="dx2" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><lnTo><pt x="l" y="x1" /></lnTo><arcTo wR="x1" hR="x1" stAng="cd2" swAng="cd4" /><close /></path></pathLst>';
var ll = '<gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="md" fmla="mod w h 0" /><gd name="dx" fmla="*/ 1 md 20" /><gd name="y1" fmla="+- 0 b dx" /><gd name="x1" fmla="+- 0 r dx" /></gdLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd2"><pos x="l" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="dx" /></cxn><cxn ang="cd2"><pos x="l" y="y1" /></cxn><cxn ang="cd2"><pos x="l" y="b" /></cxn><cxn ang="cd2"><pos x="dx" y="dx" /></cxn><cxn ang="cd2"><pos x="dx" y="x1" /></cxn><cxn ang="3cd4"><pos x="dx" y="t" /></cxn><cxn ang="3cd4"><pos x="x1" y="t" /></cxn><cxn ang="cd4"><pos x="dx" y="b" /></cxn><cxn ang="cd4"><pos x="x1" y="b" /></cxn><cxn ang="0"><pos x="r" y="t" /></cxn><cxn ang="0"><pos x="r" y="dx" /></cxn><cxn ang="0"><pos x="r" y="y1" /></cxn><cxn ang="0"><pos x="r" y="b" /></cxn><cxn ang="0"><pos x="x1" y="dx" /></cxn><cxn ang="0"><pos x="x1" y="y1" /></cxn></cxnLst><rect l="dx" t="dx" r="x1" b="y1" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="dx" y="t" /></lnTo><lnTo><pt x="dx" y="dx" /></lnTo><lnTo><pt x="l" y="dx" /></lnTo><close /></path><path><moveTo><pt x="l" y="y1" /></moveTo><lnTo><pt x="dx" y="y1" /></lnTo><lnTo><pt x="dx" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path><path><moveTo><pt x="x1" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="dx" /></lnTo><lnTo><pt x="x1" y="dx" /></lnTo><close /></path><path><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="r" y="y1" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="x1" y="b" /></lnTo><close /></path></pathLst>';
var sl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 42533" /><gd name="hf" fmla="val 105146" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="swd2" fmla="*/ wd2 hf 100000" /><gd name="dx1" fmla="*/ swd2 95106 100000" /><gd name="dx2" fmla="*/ swd2 58779 100000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- hc dx2 0" /><gd name="x4" fmla="+- hc dx1 0" /><gd name="dy1" fmla="*/ hd2 80902 100000" /><gd name="dy2" fmla="*/ hd2 30902 100000" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y2" fmla="+- vc 0 dy2" /><gd name="y3" fmla="+- vc dy2 0" /><gd name="y4" fmla="+- vc dy1 0" /><gd name="iwd2" fmla="*/ swd2 a 50000" /><gd name="ihd2" fmla="*/ hd2 a 50000" /><gd name="sdx1" fmla="*/ iwd2 80902 100000" /><gd name="sdx2" fmla="*/ iwd2 30902 100000" /><gd name="sdy1" fmla="*/ ihd2 95106 100000" /><gd name="sdy2" fmla="*/ ihd2 58779 100000" /><gd name="sx1" fmla="+- hc 0 iwd2" /><gd name="sx2" fmla="+- hc 0 sdx1" /><gd name="sx3" fmla="+- hc 0 sdx2" /><gd name="sx4" fmla="+- hc sdx2 0" /><gd name="sx5" fmla="+- hc sdx1 0" /><gd name="sx6" fmla="+- hc iwd2 0" /><gd name="sy1" fmla="+- vc 0 sdy1" /><gd name="sy2" fmla="+- vc 0 sdy2" /><gd name="sy3" fmla="+- vc sdy2 0" /><gd name="sy4" fmla="+- vc sdy1 0" /><gd name="yAdj" fmla="+- vc 0 ihd2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="50000"><pos x="hc" y="yAdj" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="x4" y="y2" /></cxn><cxn ang="0"><pos x="x4" y="y3" /></cxn><cxn ang="cd4"><pos x="x3" y="y4" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd4"><pos x="x2" y="y4" /></cxn><cxn ang="cd2"><pos x="x1" y="y3" /></cxn><cxn ang="cd2"><pos x="x1" y="y2" /></cxn><cxn ang="3cd4"><pos x="x2" y="y1" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="3cd4"><pos x="x3" y="y1" /></cxn></cxnLst><rect l="sx2" t="sy2" r="sx5" b="sy3" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y2" /></moveTo><lnTo><pt x="sx2" y="sy2" /></lnTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="sx3" y="sy1" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="sx4" y="sy1" /></lnTo><lnTo><pt x="x3" y="y1" /></lnTo><lnTo><pt x="sx5" y="sy2" /></lnTo><lnTo><pt x="x4" y="y2" /></lnTo><lnTo><pt x="sx6" y="vc" /></lnTo><lnTo><pt x="x4" y="y3" /></lnTo><lnTo><pt x="sx5" y="sy3" /></lnTo><lnTo><pt x="x3" y="y4" /></lnTo><lnTo><pt x="sx4" y="sy4" /></lnTo><lnTo><pt x="hc" y="b" /></lnTo><lnTo><pt x="sx3" y="sy4" /></lnTo><lnTo><pt x="x2" y="y4" /></lnTo><lnTo><pt x="sx2" y="sy3" /></lnTo><lnTo><pt x="x1" y="y3" /></lnTo><lnTo><pt x="sx1" y="vc" /></lnTo><close /></path></pathLst>';
var el = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 37500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="dx1" fmla="cos wd2 1800000" /><gd name="dy1" fmla="sin hd2 3600000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x3" fmla="*/ w 3 4" /><gd name="x4" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y3" fmla="*/ h 3 4" /><gd name="y4" fmla="+- vc dy1 0" /><gd name="iwd2" fmla="*/ wd2 a 50000" /><gd name="ihd2" fmla="*/ hd2 a 50000" /><gd name="sdx1" fmla="cos iwd2 900000" /><gd name="sdx2" fmla="cos iwd2 2700000" /><gd name="sdx3" fmla="cos iwd2 4500000" /><gd name="sdy1" fmla="sin ihd2 4500000" /><gd name="sdy2" fmla="sin ihd2 2700000" /><gd name="sdy3" fmla="sin ihd2 900000" /><gd name="sx1" fmla="+- hc 0 sdx1" /><gd name="sx2" fmla="+- hc 0 sdx2" /><gd name="sx3" fmla="+- hc 0 sdx3" /><gd name="sx4" fmla="+- hc sdx3 0" /><gd name="sx5" fmla="+- hc sdx2 0" /><gd name="sx6" fmla="+- hc sdx1 0" /><gd name="sy1" fmla="+- vc 0 sdy1" /><gd name="sy2" fmla="+- vc 0 sdy2" /><gd name="sy3" fmla="+- vc 0 sdy3" /><gd name="sy4" fmla="+- vc sdy3 0" /><gd name="sy5" fmla="+- vc sdy2 0" /><gd name="sy6" fmla="+- vc sdy1 0" /><gd name="yAdj" fmla="+- vc 0 ihd2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="50000"><pos x="hc" y="yAdj" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="x4" y="hd4" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="0"><pos x="x4" y="y3" /></cxn><cxn ang="cd4"><pos x="x3" y="y4" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd4"><pos x="wd4" y="y4" /></cxn><cxn ang="cd2"><pos x="x1" y="y3" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd2"><pos x="x1" y="hd4" /></cxn><cxn ang="3cd4"><pos x="wd4" y="y1" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="3cd4"><pos x="x3" y="y1" /></cxn></cxnLst><rect l="sx2" t="sy2" r="sx5" b="sy5" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="sx1" y="sy3" /></lnTo><lnTo><pt x="x1" y="hd4" /></lnTo><lnTo><pt x="sx2" y="sy2" /></lnTo><lnTo><pt x="wd4" y="y1" /></lnTo><lnTo><pt x="sx3" y="sy1" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="sx4" y="sy1" /></lnTo><lnTo><pt x="x3" y="y1" /></lnTo><lnTo><pt x="sx5" y="sy2" /></lnTo><lnTo><pt x="x4" y="hd4" /></lnTo><lnTo><pt x="sx6" y="sy3" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="sx6" y="sy4" /></lnTo><lnTo><pt x="x4" y="y3" /></lnTo><lnTo><pt x="sx5" y="sy5" /></lnTo><lnTo><pt x="x3" y="y4" /></lnTo><lnTo><pt x="sx4" y="sy6" /></lnTo><lnTo><pt x="hc" y="b" /></lnTo><lnTo><pt x="sx3" y="sy6" /></lnTo><lnTo><pt x="wd4" y="y4" /></lnTo><lnTo><pt x="sx2" y="sy5" /></lnTo><lnTo><pt x="x1" y="y3" /></lnTo><lnTo><pt x="sx1" y="sy4" /></lnTo><close /></path></pathLst>';
var dl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 37500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="dx1" fmla="*/ wd2 92388 100000" /><gd name="dx2" fmla="*/ wd2 70711 100000" /><gd name="dx3" fmla="*/ wd2 38268 100000" /><gd name="dy1" fmla="*/ hd2 92388 100000" /><gd name="dy2" fmla="*/ hd2 70711 100000" /><gd name="dy3" fmla="*/ hd2 38268 100000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- hc 0 dx3" /><gd name="x4" fmla="+- hc dx3 0" /><gd name="x5" fmla="+- hc dx2 0" /><gd name="x6" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y2" fmla="+- vc 0 dy2" /><gd name="y3" fmla="+- vc 0 dy3" /><gd name="y4" fmla="+- vc dy3 0" /><gd name="y5" fmla="+- vc dy2 0" /><gd name="y6" fmla="+- vc dy1 0" /><gd name="iwd2" fmla="*/ wd2 a 50000" /><gd name="ihd2" fmla="*/ hd2 a 50000" /><gd name="sdx1" fmla="*/ iwd2 98079 100000" /><gd name="sdx2" fmla="*/ iwd2 83147 100000" /><gd name="sdx3" fmla="*/ iwd2 55557 100000" /><gd name="sdx4" fmla="*/ iwd2 19509 100000" /><gd name="sdy1" fmla="*/ ihd2 98079 100000" /><gd name="sdy2" fmla="*/ ihd2 83147 100000" /><gd name="sdy3" fmla="*/ ihd2 55557 100000" /><gd name="sdy4" fmla="*/ ihd2 19509 100000" /><gd name="sx1" fmla="+- hc 0 sdx1" /><gd name="sx2" fmla="+- hc 0 sdx2" /><gd name="sx3" fmla="+- hc 0 sdx3" /><gd name="sx4" fmla="+- hc 0 sdx4" /><gd name="sx5" fmla="+- hc sdx4 0" /><gd name="sx6" fmla="+- hc sdx3 0" /><gd name="sx7" fmla="+- hc sdx2 0" /><gd name="sx8" fmla="+- hc sdx1 0" /><gd name="sy1" fmla="+- vc 0 sdy1" /><gd name="sy2" fmla="+- vc 0 sdy2" /><gd name="sy3" fmla="+- vc 0 sdy3" /><gd name="sy4" fmla="+- vc 0 sdy4" /><gd name="sy5" fmla="+- vc sdy4 0" /><gd name="sy6" fmla="+- vc sdy3 0" /><gd name="sy7" fmla="+- vc sdy2 0" /><gd name="sy8" fmla="+- vc sdy1 0" /><gd name="idx" fmla="cos iwd2 2700000" /><gd name="idy" fmla="sin ihd2 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ir" fmla="+- hc idx 0" /><gd name="ib" fmla="+- vc idy 0" /><gd name="yAdj" fmla="+- vc 0 ihd2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="50000"><pos x="hc" y="yAdj" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="x5" y="y2" /></cxn><cxn ang="0"><pos x="x6" y="y3" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="0"><pos x="x6" y="y4" /></cxn><cxn ang="0"><pos x="x5" y="y5" /></cxn><cxn ang="cd4"><pos x="x4" y="y6" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd4"><pos x="x3" y="y6" /></cxn><cxn ang="cd2"><pos x="x2" y="y5" /></cxn><cxn ang="cd2"><pos x="x1" y="y4" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd2"><pos x="x1" y="y3" /></cxn><cxn ang="cd2"><pos x="x2" y="y2" /></cxn><cxn ang="3cd4"><pos x="x3" y="y1" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="3cd4"><pos x="x4" y="y1" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="sx1" y="sy4" /></lnTo><lnTo><pt x="x1" y="y3" /></lnTo><lnTo><pt x="sx2" y="sy3" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="sx3" y="sy2" /></lnTo><lnTo><pt x="x3" y="y1" /></lnTo><lnTo><pt x="sx4" y="sy1" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="sx5" y="sy1" /></lnTo><lnTo><pt x="x4" y="y1" /></lnTo><lnTo><pt x="sx6" y="sy2" /></lnTo><lnTo><pt x="x5" y="y2" /></lnTo><lnTo><pt x="sx7" y="sy3" /></lnTo><lnTo><pt x="x6" y="y3" /></lnTo><lnTo><pt x="sx8" y="sy4" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="sx8" y="sy5" /></lnTo><lnTo><pt x="x6" y="y4" /></lnTo><lnTo><pt x="sx7" y="sy6" /></lnTo><lnTo><pt x="x5" y="y5" /></lnTo><lnTo><pt x="sx6" y="sy7" /></lnTo><lnTo><pt x="x4" y="y6" /></lnTo><lnTo><pt x="sx5" y="sy8" /></lnTo><lnTo><pt x="hc" y="b" /></lnTo><lnTo><pt x="sx4" y="sy8" /></lnTo><lnTo><pt x="x3" y="y6" /></lnTo><lnTo><pt x="sx3" y="sy7" /></lnTo><lnTo><pt x="x2" y="y5" /></lnTo><lnTo><pt x="sx2" y="sy6" /></lnTo><lnTo><pt x="x1" y="y4" /></lnTo><lnTo><pt x="sx1" y="sy5" /></lnTo><close /></path></pathLst>';
var xl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 37500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="dx1" fmla="cos wd2 900000" /><gd name="dx2" fmla="cos wd2 1800000" /><gd name="dx3" fmla="cos wd2 2700000" /><gd name="dx4" fmla="val wd4" /><gd name="dx5" fmla="cos wd2 4500000" /><gd name="dy1" fmla="sin hd2 4500000" /><gd name="dy2" fmla="sin hd2 3600000" /><gd name="dy3" fmla="sin hd2 2700000" /><gd name="dy4" fmla="val hd4" /><gd name="dy5" fmla="sin hd2 900000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- hc 0 dx3" /><gd name="x4" fmla="+- hc 0 dx4" /><gd name="x5" fmla="+- hc 0 dx5" /><gd name="x6" fmla="+- hc dx5 0" /><gd name="x7" fmla="+- hc dx4 0" /><gd name="x8" fmla="+- hc dx3 0" /><gd name="x9" fmla="+- hc dx2 0" /><gd name="x10" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y2" fmla="+- vc 0 dy2" /><gd name="y3" fmla="+- vc 0 dy3" /><gd name="y4" fmla="+- vc 0 dy4" /><gd name="y5" fmla="+- vc 0 dy5" /><gd name="y6" fmla="+- vc dy5 0" /><gd name="y7" fmla="+- vc dy4 0" /><gd name="y8" fmla="+- vc dy3 0" /><gd name="y9" fmla="+- vc dy2 0" /><gd name="y10" fmla="+- vc dy1 0" /><gd name="iwd2" fmla="*/ wd2 a 50000" /><gd name="ihd2" fmla="*/ hd2 a 50000" /><gd name="sdx1" fmla="*/ iwd2 99144 100000" /><gd name="sdx2" fmla="*/ iwd2 92388 100000" /><gd name="sdx3" fmla="*/ iwd2 79335 100000" /><gd name="sdx4" fmla="*/ iwd2 60876 100000" /><gd name="sdx5" fmla="*/ iwd2 38268 100000" /><gd name="sdx6" fmla="*/ iwd2 13053 100000" /><gd name="sdy1" fmla="*/ ihd2 99144 100000" /><gd name="sdy2" fmla="*/ ihd2 92388 100000" /><gd name="sdy3" fmla="*/ ihd2 79335 100000" /><gd name="sdy4" fmla="*/ ihd2 60876 100000" /><gd name="sdy5" fmla="*/ ihd2 38268 100000" /><gd name="sdy6" fmla="*/ ihd2 13053 100000" /><gd name="sx1" fmla="+- hc 0 sdx1" /><gd name="sx2" fmla="+- hc 0 sdx2" /><gd name="sx3" fmla="+- hc 0 sdx3" /><gd name="sx4" fmla="+- hc 0 sdx4" /><gd name="sx5" fmla="+- hc 0 sdx5" /><gd name="sx6" fmla="+- hc 0 sdx6" /><gd name="sx7" fmla="+- hc sdx6 0" /><gd name="sx8" fmla="+- hc sdx5 0" /><gd name="sx9" fmla="+- hc sdx4 0" /><gd name="sx10" fmla="+- hc sdx3 0" /><gd name="sx11" fmla="+- hc sdx2 0" /><gd name="sx12" fmla="+- hc sdx1 0" /><gd name="sy1" fmla="+- vc 0 sdy1" /><gd name="sy2" fmla="+- vc 0 sdy2" /><gd name="sy3" fmla="+- vc 0 sdy3" /><gd name="sy4" fmla="+- vc 0 sdy4" /><gd name="sy5" fmla="+- vc 0 sdy5" /><gd name="sy6" fmla="+- vc 0 sdy6" /><gd name="sy7" fmla="+- vc sdy6 0" /><gd name="sy8" fmla="+- vc sdy5 0" /><gd name="sy9" fmla="+- vc sdy4 0" /><gd name="sy10" fmla="+- vc sdy3 0" /><gd name="sy11" fmla="+- vc sdy2 0" /><gd name="sy12" fmla="+- vc sdy1 0" /><gd name="idx" fmla="cos iwd2 2700000" /><gd name="idy" fmla="sin ihd2 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ir" fmla="+- hc idx 0" /><gd name="ib" fmla="+- vc idy 0" /><gd name="yAdj" fmla="+- vc 0 ihd2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="ssd2"><pos x="hc" y="yAdj" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="sx1" y="sy6" /></lnTo><lnTo><pt x="x1" y="y5" /></lnTo><lnTo><pt x="sx2" y="sy5" /></lnTo><lnTo><pt x="x2" y="y4" /></lnTo><lnTo><pt x="sx3" y="sy4" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo><lnTo><pt x="sx4" y="sy3" /></lnTo><lnTo><pt x="x4" y="y2" /></lnTo><lnTo><pt x="sx5" y="sy2" /></lnTo><lnTo><pt x="x5" y="y1" /></lnTo><lnTo><pt x="sx6" y="sy1" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="sx7" y="sy1" /></lnTo><lnTo><pt x="x6" y="y1" /></lnTo><lnTo><pt x="sx8" y="sy2" /></lnTo><lnTo><pt x="x7" y="y2" /></lnTo><lnTo><pt x="sx9" y="sy3" /></lnTo><lnTo><pt x="x8" y="y3" /></lnTo><lnTo><pt x="sx10" y="sy4" /></lnTo><lnTo><pt x="x9" y="y4" /></lnTo><lnTo><pt x="sx11" y="sy5" /></lnTo><lnTo><pt x="x10" y="y5" /></lnTo><lnTo><pt x="sx12" y="sy6" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="sx12" y="sy7" /></lnTo><lnTo><pt x="x10" y="y6" /></lnTo><lnTo><pt x="sx11" y="sy8" /></lnTo><lnTo><pt x="x9" y="y7" /></lnTo><lnTo><pt x="sx10" y="sy9" /></lnTo><lnTo><pt x="x8" y="y8" /></lnTo><lnTo><pt x="sx9" y="sy10" /></lnTo><lnTo><pt x="x7" y="y9" /></lnTo><lnTo><pt x="sx8" y="sy11" /></lnTo><lnTo><pt x="x6" y="y10" /></lnTo><lnTo><pt x="sx7" y="sy12" /></lnTo><lnTo><pt x="hc" y="b" /></lnTo><lnTo><pt x="sx6" y="sy12" /></lnTo><lnTo><pt x="x5" y="y10" /></lnTo><lnTo><pt x="sx5" y="sy11" /></lnTo><lnTo><pt x="x4" y="y9" /></lnTo><lnTo><pt x="sx4" y="sy10" /></lnTo><lnTo><pt x="x3" y="y8" /></lnTo><lnTo><pt x="sx3" y="sy9" /></lnTo><lnTo><pt x="x2" y="y7" /></lnTo><lnTo><pt x="sx2" y="sy8" /></lnTo><lnTo><pt x="x1" y="y6" /></lnTo><lnTo><pt x="sx1" y="sy7" /></lnTo><close /></path></pathLst>';
var gl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 37500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="dx1" fmla="*/ wd2 98079 100000" /><gd name="dx2" fmla="*/ wd2 92388 100000" /><gd name="dx3" fmla="*/ wd2 83147 100000" /><gd name="dx4" fmla="cos wd2 2700000" /><gd name="dx5" fmla="*/ wd2 55557 100000" /><gd name="dx6" fmla="*/ wd2 38268 100000" /><gd name="dx7" fmla="*/ wd2 19509 100000" /><gd name="dy1" fmla="*/ hd2 98079 100000" /><gd name="dy2" fmla="*/ hd2 92388 100000" /><gd name="dy3" fmla="*/ hd2 83147 100000" /><gd name="dy4" fmla="sin hd2 2700000" /><gd name="dy5" fmla="*/ hd2 55557 100000" /><gd name="dy6" fmla="*/ hd2 38268 100000" /><gd name="dy7" fmla="*/ hd2 19509 100000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- hc 0 dx3" /><gd name="x4" fmla="+- hc 0 dx4" /><gd name="x5" fmla="+- hc 0 dx5" /><gd name="x6" fmla="+- hc 0 dx6" /><gd name="x7" fmla="+- hc 0 dx7" /><gd name="x8" fmla="+- hc dx7 0" /><gd name="x9" fmla="+- hc dx6 0" /><gd name="x10" fmla="+- hc dx5 0" /><gd name="x11" fmla="+- hc dx4 0" /><gd name="x12" fmla="+- hc dx3 0" /><gd name="x13" fmla="+- hc dx2 0" /><gd name="x14" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y2" fmla="+- vc 0 dy2" /><gd name="y3" fmla="+- vc 0 dy3" /><gd name="y4" fmla="+- vc 0 dy4" /><gd name="y5" fmla="+- vc 0 dy5" /><gd name="y6" fmla="+- vc 0 dy6" /><gd name="y7" fmla="+- vc 0 dy7" /><gd name="y8" fmla="+- vc dy7 0" /><gd name="y9" fmla="+- vc dy6 0" /><gd name="y10" fmla="+- vc dy5 0" /><gd name="y11" fmla="+- vc dy4 0" /><gd name="y12" fmla="+- vc dy3 0" /><gd name="y13" fmla="+- vc dy2 0" /><gd name="y14" fmla="+- vc dy1 0" /><gd name="iwd2" fmla="*/ wd2 a 50000" /><gd name="ihd2" fmla="*/ hd2 a 50000" /><gd name="sdx1" fmla="*/ iwd2 99518 100000" /><gd name="sdx2" fmla="*/ iwd2 95694 100000" /><gd name="sdx3" fmla="*/ iwd2 88192 100000" /><gd name="sdx4" fmla="*/ iwd2 77301 100000" /><gd name="sdx5" fmla="*/ iwd2 63439 100000" /><gd name="sdx6" fmla="*/ iwd2 47140 100000" /><gd name="sdx7" fmla="*/ iwd2 29028 100000" /><gd name="sdx8" fmla="*/ iwd2 9802 100000" /><gd name="sdy1" fmla="*/ ihd2 99518 100000" /><gd name="sdy2" fmla="*/ ihd2 95694 100000" /><gd name="sdy3" fmla="*/ ihd2 88192 100000" /><gd name="sdy4" fmla="*/ ihd2 77301 100000" /><gd name="sdy5" fmla="*/ ihd2 63439 100000" /><gd name="sdy6" fmla="*/ ihd2 47140 100000" /><gd name="sdy7" fmla="*/ ihd2 29028 100000" /><gd name="sdy8" fmla="*/ ihd2 9802 100000" /><gd name="sx1" fmla="+- hc 0 sdx1" /><gd name="sx2" fmla="+- hc 0 sdx2" /><gd name="sx3" fmla="+- hc 0 sdx3" /><gd name="sx4" fmla="+- hc 0 sdx4" /><gd name="sx5" fmla="+- hc 0 sdx5" /><gd name="sx6" fmla="+- hc 0 sdx6" /><gd name="sx7" fmla="+- hc 0 sdx7" /><gd name="sx8" fmla="+- hc 0 sdx8" /><gd name="sx9" fmla="+- hc sdx8 0" /><gd name="sx10" fmla="+- hc sdx7 0" /><gd name="sx11" fmla="+- hc sdx6 0" /><gd name="sx12" fmla="+- hc sdx5 0" /><gd name="sx13" fmla="+- hc sdx4 0" /><gd name="sx14" fmla="+- hc sdx3 0" /><gd name="sx15" fmla="+- hc sdx2 0" /><gd name="sx16" fmla="+- hc sdx1 0" /><gd name="sy1" fmla="+- vc 0 sdy1" /><gd name="sy2" fmla="+- vc 0 sdy2" /><gd name="sy3" fmla="+- vc 0 sdy3" /><gd name="sy4" fmla="+- vc 0 sdy4" /><gd name="sy5" fmla="+- vc 0 sdy5" /><gd name="sy6" fmla="+- vc 0 sdy6" /><gd name="sy7" fmla="+- vc 0 sdy7" /><gd name="sy8" fmla="+- vc 0 sdy8" /><gd name="sy9" fmla="+- vc sdy8 0" /><gd name="sy10" fmla="+- vc sdy7 0" /><gd name="sy11" fmla="+- vc sdy6 0" /><gd name="sy12" fmla="+- vc sdy5 0" /><gd name="sy13" fmla="+- vc sdy4 0" /><gd name="sy14" fmla="+- vc sdy3 0" /><gd name="sy15" fmla="+- vc sdy2 0" /><gd name="sy16" fmla="+- vc sdy1 0" /><gd name="idx" fmla="cos iwd2 2700000" /><gd name="idy" fmla="sin ihd2 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ir" fmla="+- hc idx 0" /><gd name="ib" fmla="+- vc idy 0" /><gd name="yAdj" fmla="+- vc 0 ihd2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="ssd2"><pos x="hc" y="yAdj" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="sx1" y="sy8" /></lnTo><lnTo><pt x="x1" y="y7" /></lnTo><lnTo><pt x="sx2" y="sy7" /></lnTo><lnTo><pt x="x2" y="y6" /></lnTo><lnTo><pt x="sx3" y="sy6" /></lnTo><lnTo><pt x="x3" y="y5" /></lnTo><lnTo><pt x="sx4" y="sy5" /></lnTo><lnTo><pt x="x4" y="y4" /></lnTo><lnTo><pt x="sx5" y="sy4" /></lnTo><lnTo><pt x="x5" y="y3" /></lnTo><lnTo><pt x="sx6" y="sy3" /></lnTo><lnTo><pt x="x6" y="y2" /></lnTo><lnTo><pt x="sx7" y="sy2" /></lnTo><lnTo><pt x="x7" y="y1" /></lnTo><lnTo><pt x="sx8" y="sy1" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="sx9" y="sy1" /></lnTo><lnTo><pt x="x8" y="y1" /></lnTo><lnTo><pt x="sx10" y="sy2" /></lnTo><lnTo><pt x="x9" y="y2" /></lnTo><lnTo><pt x="sx11" y="sy3" /></lnTo><lnTo><pt x="x10" y="y3" /></lnTo><lnTo><pt x="sx12" y="sy4" /></lnTo><lnTo><pt x="x11" y="y4" /></lnTo><lnTo><pt x="sx13" y="sy5" /></lnTo><lnTo><pt x="x12" y="y5" /></lnTo><lnTo><pt x="sx14" y="sy6" /></lnTo><lnTo><pt x="x13" y="y6" /></lnTo><lnTo><pt x="sx15" y="sy7" /></lnTo><lnTo><pt x="x14" y="y7" /></lnTo><lnTo><pt x="sx16" y="sy8" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="sx16" y="sy9" /></lnTo><lnTo><pt x="x14" y="y8" /></lnTo><lnTo><pt x="sx15" y="sy10" /></lnTo><lnTo><pt x="x13" y="y9" /></lnTo><lnTo><pt x="sx14" y="sy11" /></lnTo><lnTo><pt x="x12" y="y10" /></lnTo><lnTo><pt x="sx13" y="sy12" /></lnTo><lnTo><pt x="x11" y="y11" /></lnTo><lnTo><pt x="sx12" y="sy13" /></lnTo><lnTo><pt x="x10" y="y12" /></lnTo><lnTo><pt x="sx11" y="sy14" /></lnTo><lnTo><pt x="x9" y="y13" /></lnTo><lnTo><pt x="sx10" y="sy15" /></lnTo><lnTo><pt x="x8" y="y14" /></lnTo><lnTo><pt x="sx9" y="sy16" /></lnTo><lnTo><pt x="hc" y="b" /></lnTo><lnTo><pt x="sx8" y="sy16" /></lnTo><lnTo><pt x="x7" y="y14" /></lnTo><lnTo><pt x="sx7" y="sy15" /></lnTo><lnTo><pt x="x6" y="y13" /></lnTo><lnTo><pt x="sx6" y="sy14" /></lnTo><lnTo><pt x="x5" y="y12" /></lnTo><lnTo><pt x="sx5" y="sy13" /></lnTo><lnTo><pt x="x4" y="y11" /></lnTo><lnTo><pt x="sx4" y="sy12" /></lnTo><lnTo><pt x="x3" y="y10" /></lnTo><lnTo><pt x="sx3" y="sy11" /></lnTo><lnTo><pt x="x2" y="y9" /></lnTo><lnTo><pt x="sx2" y="sy10" /></lnTo><lnTo><pt x="x1" y="y8" /></lnTo><lnTo><pt x="sx1" y="sy9" /></lnTo><close /></path></pathLst>';
var cl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 12500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="iwd2" fmla="*/ wd2 a 50000" /><gd name="ihd2" fmla="*/ hd2 a 50000" /><gd name="sdx" fmla="cos iwd2 2700000" /><gd name="sdy" fmla="sin ihd2 2700000" /><gd name="sx1" fmla="+- hc 0 sdx" /><gd name="sx2" fmla="+- hc sdx 0" /><gd name="sy1" fmla="+- vc 0 sdy" /><gd name="sy2" fmla="+- vc sdy 0" /><gd name="yAdj" fmla="+- vc 0 ihd2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="50000"><pos x="hc" y="yAdj" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="sx1" t="sy1" r="sx2" b="sy2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="sx1" y="sy1" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="sx2" y="sy1" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="sx2" y="sy2" /></lnTo><lnTo><pt x="hc" y="b" /></lnTo><lnTo><pt x="sx1" y="sy2" /></lnTo><close /></path></pathLst>';
var rl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 19098" /><gd name="hf" fmla="val 105146" /><gd name="vf" fmla="val 110557" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="swd2" fmla="*/ wd2 hf 100000" /><gd name="shd2" fmla="*/ hd2 vf 100000" /><gd name="svc" fmla="*/ vc  vf 100000" /><gd name="dx1" fmla="cos swd2 1080000" /><gd name="dx2" fmla="cos swd2 18360000" /><gd name="dy1" fmla="sin shd2 1080000" /><gd name="dy2" fmla="sin shd2 18360000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- hc dx2 0" /><gd name="x4" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- svc 0 dy1" /><gd name="y2" fmla="+- svc 0 dy2" /><gd name="iwd2" fmla="*/ swd2 a 50000" /><gd name="ihd2" fmla="*/ shd2 a 50000" /><gd name="sdx1" fmla="cos iwd2 20520000" /><gd name="sdx2" fmla="cos iwd2 3240000" /><gd name="sdy1" fmla="sin ihd2 3240000" /><gd name="sdy2" fmla="sin ihd2 20520000" /><gd name="sx1" fmla="+- hc 0 sdx1" /><gd name="sx2" fmla="+- hc 0 sdx2" /><gd name="sx3" fmla="+- hc sdx2 0" /><gd name="sx4" fmla="+- hc sdx1 0" /><gd name="sy1" fmla="+- svc 0 sdy1" /><gd name="sy2" fmla="+- svc 0 sdy2" /><gd name="sy3" fmla="+- svc ihd2 0" /><gd name="yAdj" fmla="+- svc 0 ihd2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="50000"><pos x="hc" y="yAdj" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="x1" y="y1" /></cxn><cxn ang="cd4"><pos x="x2" y="y2" /></cxn><cxn ang="cd4"><pos x="x3" y="y2" /></cxn><cxn ang="0"><pos x="x4" y="y1" /></cxn></cxnLst><rect l="sx1" t="sy1" r="sx4" b="sy3" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y1" /></moveTo><lnTo><pt x="sx2" y="sy1" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="sx3" y="sy1" /></lnTo><lnTo><pt x="x4" y="y1" /></lnTo><lnTo><pt x="sx4" y="sy2" /></lnTo><lnTo><pt x="x3" y="y2" /></lnTo><lnTo><pt x="hc" y="sy3" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="sx1" y="sy2" /></lnTo><close /></path></pathLst>';
var pl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 28868" /><gd name="hf" fmla="val 115470" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="swd2" fmla="*/ wd2 hf 100000" /><gd name="dx1" fmla="cos swd2 1800000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc dx1 0" /><gd name="y2" fmla="+- vc hd4 0" /><gd name="iwd2" fmla="*/ swd2 a 50000" /><gd name="ihd2" fmla="*/ hd2 a 50000" /><gd name="sdx2" fmla="*/ iwd2 1 2" /><gd name="sx1" fmla="+- hc 0 iwd2" /><gd name="sx2" fmla="+- hc 0 sdx2" /><gd name="sx3" fmla="+- hc sdx2 0" /><gd name="sx4" fmla="+- hc iwd2 0" /><gd name="sdy1" fmla="sin ihd2 3600000" /><gd name="sy1" fmla="+- vc 0 sdy1" /><gd name="sy2" fmla="+- vc sdy1 0" /><gd name="yAdj" fmla="+- vc 0 ihd2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="50000"><pos x="hc" y="yAdj" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="x2" y="hd4" /></cxn><cxn ang="0"><pos x="x2" y="y2" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="x1" y="y2" /></cxn><cxn ang="cd2"><pos x="x1" y="hd4" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="sx1" t="sy1" r="sx4" b="sy2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="hd4" /></moveTo><lnTo><pt x="sx2" y="sy1" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="sx3" y="sy1" /></lnTo><lnTo><pt x="x2" y="hd4" /></lnTo><lnTo><pt x="sx4" y="vc" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="sx3" y="sy2" /></lnTo><lnTo><pt x="hc" y="b" /></lnTo><lnTo><pt x="sx2" y="sy2" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><lnTo><pt x="sx1" y="vc" /></lnTo><close /></path></pathLst>';
var il = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 34601" /><gd name="hf" fmla="val 102572" /><gd name="vf" fmla="val 105210" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="swd2" fmla="*/ wd2 hf 100000" /><gd name="shd2" fmla="*/ hd2 vf 100000" /><gd name="svc" fmla="*/ vc  vf 100000" /><gd name="dx1" fmla="*/ swd2 97493 100000" /><gd name="dx2" fmla="*/ swd2 78183 100000" /><gd name="dx3" fmla="*/ swd2 43388 100000" /><gd name="dy1" fmla="*/ shd2 62349 100000" /><gd name="dy2" fmla="*/ shd2 22252 100000" /><gd name="dy3" fmla="*/ shd2 90097 100000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- hc 0 dx3" /><gd name="x4" fmla="+- hc dx3 0" /><gd name="x5" fmla="+- hc dx2 0" /><gd name="x6" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- svc 0 dy1" /><gd name="y2" fmla="+- svc dy2 0" /><gd name="y3" fmla="+- svc dy3 0" /><gd name="iwd2" fmla="*/ swd2 a 50000" /><gd name="ihd2" fmla="*/ shd2 a 50000" /><gd name="sdx1" fmla="*/ iwd2 97493 100000" /><gd name="sdx2" fmla="*/ iwd2 78183 100000" /><gd name="sdx3" fmla="*/ iwd2 43388 100000" /><gd name="sx1" fmla="+- hc 0 sdx1" /><gd name="sx2" fmla="+- hc 0 sdx2" /><gd name="sx3" fmla="+- hc 0 sdx3" /><gd name="sx4" fmla="+- hc sdx3 0" /><gd name="sx5" fmla="+- hc sdx2 0" /><gd name="sx6" fmla="+- hc sdx1 0" /><gd name="sdy1" fmla="*/ ihd2 90097 100000" /><gd name="sdy2" fmla="*/ ihd2 22252 100000" /><gd name="sdy3" fmla="*/ ihd2 62349 100000" /><gd name="sy1" fmla="+- svc 0 sdy1" /><gd name="sy2" fmla="+- svc 0 sdy2" /><gd name="sy3" fmla="+- svc sdy3 0" /><gd name="sy4" fmla="+- svc ihd2 0" /><gd name="yAdj" fmla="+- svc 0 ihd2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="50000"><pos x="hc" y="yAdj" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="x5" y="y1" /></cxn><cxn ang="0"><pos x="x6" y="y2" /></cxn><cxn ang="cd4"><pos x="x4" y="y3" /></cxn><cxn ang="cd4"><pos x="x3" y="y3" /></cxn><cxn ang="cd2"><pos x="x1" y="y2" /></cxn><cxn ang="cd2"><pos x="x2" y="y1" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn></cxnLst><rect l="sx2" t="sy1" r="sx5" b="sy3" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y2" /></moveTo><lnTo><pt x="sx1" y="sy2" /></lnTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="sx3" y="sy1" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="sx4" y="sy1" /></lnTo><lnTo><pt x="x5" y="y1" /></lnTo><lnTo><pt x="sx6" y="sy2" /></lnTo><lnTo><pt x="x6" y="y2" /></lnTo><lnTo><pt x="sx5" y="sy3" /></lnTo><lnTo><pt x="x4" y="y3" /></lnTo><lnTo><pt x="hc" y="sy4" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo><lnTo><pt x="sx2" y="sy3" /></lnTo><close /></path></pathLst>';
var fl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 37500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="dx1" fmla="cos wd2 2700000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc dx1 0" /><gd name="dy1" fmla="sin hd2 2700000" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y2" fmla="+- vc dy1 0" /><gd name="iwd2" fmla="*/ wd2 a 50000" /><gd name="ihd2" fmla="*/ hd2 a 50000" /><gd name="sdx1" fmla="*/ iwd2 92388 100000" /><gd name="sdx2" fmla="*/ iwd2 38268 100000" /><gd name="sdy1" fmla="*/ ihd2 92388 100000" /><gd name="sdy2" fmla="*/ ihd2 38268 100000" /><gd name="sx1" fmla="+- hc 0 sdx1" /><gd name="sx2" fmla="+- hc 0 sdx2" /><gd name="sx3" fmla="+- hc sdx2 0" /><gd name="sx4" fmla="+- hc sdx1 0" /><gd name="sy1" fmla="+- vc 0 sdy1" /><gd name="sy2" fmla="+- vc 0 sdy2" /><gd name="sy3" fmla="+- vc sdy2 0" /><gd name="sy4" fmla="+- vc sdy1 0" /><gd name="yAdj" fmla="+- vc 0 ihd2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="50000"><pos x="hc" y="yAdj" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="x2" y="y2" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd4"><pos x="x1" y="y2" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="x1" y="y1" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="3cd4"><pos x="x2" y="y1" /></cxn></cxnLst><rect l="sx1" t="sy1" r="sx4" b="sy4" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="sx1" y="sy2" /></lnTo><lnTo><pt x="x1" y="y1" /></lnTo><lnTo><pt x="sx2" y="sy1" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="sx3" y="sy1" /></lnTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="sx4" y="sy2" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="sx4" y="sy3" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="sx3" y="sy4" /></lnTo><lnTo><pt x="hc" y="b" /></lnTo><lnTo><pt x="sx2" y="sy4" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><lnTo><pt x="sx1" y="sy3" /></lnTo><close /></path></pathLst>';
var hl = '<rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path fill="none"><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="b" /></lnTo></path></pathLst>';
var yl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 50000" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 84375 w ss" /><gd name="a1" fmla="pin 0 adj1 100000" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="x4" fmla="*/ ss 5 32" /><gd name="dx5" fmla="*/ ss a2 100000" /><gd name="x5" fmla="+- r 0 dx5" /><gd name="dy1" fmla="*/ h a1 200000" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="y2" fmla="+- vc dy1 0" /><gd name="dx6" fmla="*/ dy1 dx5 hd2" /><gd name="x6" fmla="+- r 0 dx6" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="100000"><pos x="l" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="maxAdj2"><pos x="x5" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x5" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="x5" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="x4" t="y1" r="x6" b="y2" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y1" /></moveTo><lnTo><pt x="ssd32" y="y1" /></lnTo><lnTo><pt x="ssd32" y="y2" /></lnTo><lnTo><pt x="l" y="y2" /></lnTo><close /><moveTo><pt x="ssd16" y="y1" /></moveTo><lnTo><pt x="ssd8" y="y1" /></lnTo><lnTo><pt x="ssd8" y="y2" /></lnTo><lnTo><pt x="ssd16" y="y2" /></lnTo><close /><moveTo><pt x="x4" y="y1" /></moveTo><lnTo><pt x="x5" y="y1" /></lnTo><lnTo><pt x="x5" y="t" /></lnTo><lnTo><pt x="r" y="vc" /></lnTo><lnTo><pt x="x5" y="b" /></lnTo><lnTo><pt x="x5" y="y2" /></lnTo><lnTo><pt x="x4" y="y2" /></lnTo><close /></path></pathLst>';
var Tl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 12500 adj 46875" /><gd name="g0" fmla="+- 50000 0 a" /><gd name="g1" fmla="*/ g0 30274 32768" /><gd name="g2" fmla="*/ g0 12540 32768" /><gd name="g3" fmla="+- g1 50000 0" /><gd name="g4" fmla="+- g2 50000 0" /><gd name="g5" fmla="+- 50000 0 g1" /><gd name="g6" fmla="+- 50000 0 g2" /><gd name="g7" fmla="*/ g0 23170 32768" /><gd name="g8" fmla="+- 50000 g7 0" /><gd name="g9" fmla="+- 50000 0 g7" /><gd name="g10" fmla="*/ g5 3 4" /><gd name="g11" fmla="*/ g6 3 4" /><gd name="g12" fmla="+- g10 3662 0" /><gd name="g13" fmla="+- g11 3662 0" /><gd name="g14" fmla="+- g11 12500 0" /><gd name="g15" fmla="+- 100000 0 g10" /><gd name="g16" fmla="+- 100000 0 g12" /><gd name="g17" fmla="+- 100000 0 g13" /><gd name="g18" fmla="+- 100000 0 g14" /><gd name="ox1" fmla="*/ w 18436 21600" /><gd name="oy1" fmla="*/ h 3163 21600" /><gd name="ox2" fmla="*/ w 3163 21600" /><gd name="oy2" fmla="*/ h 18436 21600" /><gd name="x8" fmla="*/ w g8 100000" /><gd name="x9" fmla="*/ w g9 100000" /><gd name="x10" fmla="*/ w g10 100000" /><gd name="x12" fmla="*/ w g12 100000" /><gd name="x13" fmla="*/ w g13 100000" /><gd name="x14" fmla="*/ w g14 100000" /><gd name="x15" fmla="*/ w g15 100000" /><gd name="x16" fmla="*/ w g16 100000" /><gd name="x17" fmla="*/ w g17 100000" /><gd name="x18" fmla="*/ w g18 100000" /><gd name="x19" fmla="*/ w a 100000" /><gd name="wR" fmla="*/ w g0 100000" /><gd name="hR" fmla="*/ h g0 100000" /><gd name="y8" fmla="*/ h g8 100000" /><gd name="y9" fmla="*/ h g9 100000" /><gd name="y10" fmla="*/ h g10 100000" /><gd name="y12" fmla="*/ h g12 100000" /><gd name="y13" fmla="*/ h g13 100000" /><gd name="y14" fmla="*/ h g14 100000" /><gd name="y15" fmla="*/ h g15 100000" /><gd name="y16" fmla="*/ h g16 100000" /><gd name="y17" fmla="*/ h g17 100000" /><gd name="y18" fmla="*/ h g18 100000" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="12500" maxX="46875"><pos x="x19" y="vc" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="x9" t="y9" r="x8" b="y8" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="r" y="vc" /></moveTo><lnTo><pt x="x15" y="y18" /></lnTo><lnTo><pt x="x15" y="y14" /></lnTo><close /><moveTo><pt x="ox1" y="oy1" /></moveTo><lnTo><pt x="x16" y="y13" /></lnTo><lnTo><pt x="x17" y="y12" /></lnTo><close /><moveTo><pt x="hc" y="t" /></moveTo><lnTo><pt x="x18" y="y10" /></lnTo><lnTo><pt x="x14" y="y10" /></lnTo><close /><moveTo><pt x="ox2" y="oy1" /></moveTo><lnTo><pt x="x13" y="y12" /></lnTo><lnTo><pt x="x12" y="y13" /></lnTo><close /><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="x10" y="y14" /></lnTo><lnTo><pt x="x10" y="y18" /></lnTo><close /><moveTo><pt x="ox2" y="oy2" /></moveTo><lnTo><pt x="x12" y="y17" /></lnTo><lnTo><pt x="x13" y="y16" /></lnTo><close /><moveTo><pt x="hc" y="b" /></moveTo><lnTo><pt x="x14" y="y15" /></lnTo><lnTo><pt x="x18" y="y15" /></lnTo><close /><moveTo><pt x="ox1" y="oy2" /></moveTo><lnTo><pt x="x17" y="y16" /></lnTo><lnTo><pt x="x16" y="y17" /></lnTo><close /><moveTo><pt x="x19" y="vc" /></moveTo><arcTo wR="wR" hR="hR" stAng="cd2" swAng="21600000" /><close /></path></pathLst>';
var wl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 16667" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 1 adj1 75000" /><gd name="maxAdj2" fmla="*/ 70000 w ss" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="ad1" fmla="*/ h a1 100000" /><gd name="ad2" fmla="*/ ss a2 100000" /><gd name="xB" fmla="+- r 0 ad2" /><gd name="yB" fmla="+- t ssd8 0" /><gd name="alfa" fmla="*/ cd4 1 14" /><gd name="dx0" fmla="tan ssd8 alfa" /><gd name="xC" fmla="+- xB 0 dx0" /><gd name="dx1" fmla="tan ad1 alfa" /><gd name="yF" fmla="+- yB ad1 0" /><gd name="xF" fmla="+- xB dx1 0" /><gd name="xE" fmla="+- xF dx0 0" /><gd name="yE" fmla="+- yF ssd8 0" /><gd name="dy2" fmla="+- yE 0 t" /><gd name="dy22" fmla="*/ dy2 1 2" /><gd name="dy3" fmla="*/ h 1 20" /><gd name="yD" fmla="+- t dy22 dy3" /><gd name="dy4" fmla="*/ hd6 1 1" /><gd name="yP1" fmla="+- hd6 dy4 0" /><gd name="xP1" fmla="val wd6" /><gd name="dy5" fmla="*/ hd6 1 2" /><gd name="yP2" fmla="+- yF dy5 0" /><gd name="xP2" fmla="val wd4" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="1" maxY="75000"><pos x="xF" y="yF" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="maxAdj2"><pos x="xB" y="yB" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd4"><pos x="l" y="b" /></cxn><cxn ang="3cd4"><pos x="xC" y="t" /></cxn><cxn ang="0"><pos x="r" y="yD" /></cxn><cxn ang="cd4"><pos x="xE" y="yE" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="b" /></moveTo><quadBezTo><pt x="xP1" y="yP1" /><pt x="xB" y="yB" /></quadBezTo><lnTo><pt x="xC" y="t" /></lnTo><lnTo><pt x="r" y="yD" /></lnTo><lnTo><pt x="xE" y="yE" /></lnTo><lnTo><pt x="xF" y="yF" /></lnTo><quadBezTo><pt x="xP2" y="yP2" /><pt x="l" y="b" /></quadBezTo><close /></path></pathLst>';
var vl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 100000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 200000" /><gd name="r2" fmla="sqrt 2" /><gd name="tw" fmla="*/ wd2 r2 1" /><gd name="th" fmla="*/ hd2 r2 1" /><gd name="sw" fmla="*/ tw a 100000" /><gd name="sh" fmla="*/ th a 100000" /><gd name="dx1" fmla="cos sw 2700000" /><gd name="dy1" fmla="sin sh 2700000" /><gd name="x1" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc 0 dy1" /><gd name="x2" fmla="+/ hc x1 2" /><gd name="y2" fmla="+/ vc y1 2" /><gd name="idx" fmla="cos wd2 2700000" /><gd name="idy" fmla="sin hd2 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="ir" fmla="+- hc idx 0" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ib" fmla="+- vc idy 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="200000"><pos x="x1" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="ir" y="ib" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd4"><pos x="il" y="ib" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="3cd4"><pos x="il" y="it" /></cxn><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="3cd4"><pos x="x1" y="y1" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="vc" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="cd2" swAng="cd4" /><quadBezTo><pt x="x2" y="t" /><pt x="x1" y="y1" /></quadBezTo><quadBezTo><pt x="r" y="y2" /><pt x="r" y="vc" /></quadBezTo><arcTo wR="wd2" hR="hd2" stAng="0" swAng="cd4" /><arcTo wR="wd2" hR="hd2" stAng="cd4" swAng="cd4" /><close /></path></pathLst>';
var Ll = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 0" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adval" fmla="pin 0 adj 21599999" /><gd name="v1" fmla="+- 10800000 0 adval" /><gd name="v2" fmla="+- 32400000 0 adval" /><gd name="nv1" fmla="+- 0 0 v1" /><gd name="stAng" fmla="?: nv1 v2 v1" /><gd name="w1" fmla="+- 5400000 0 adval" /><gd name="w2" fmla="+- 16200000 0 adval" /><gd name="d1" fmla="+- adval 0 stAng" /><gd name="d2" fmla="+- d1 0 21600000" /><gd name="v3" fmla="+- 0 0 10800000" /><gd name="c2" fmla="?: w2 d1 d2" /><gd name="c1" fmla="?: v1 d2 c2" /><gd name="c0" fmla="?: w1 d1 c1" /><gd name="swAng" fmla="?: stAng c0 v3" /><gd name="wt1" fmla="sin wd2 adj" /><gd name="ht1" fmla="cos hd2 adj" /><gd name="dx1" fmla="cat2 wd2 ht1 wt1" /><gd name="dy1" fmla="sat2 hd2 ht1 wt1" /><gd name="x1" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc dy1 0" /><gd name="wt2" fmla="sin wd2 stAng" /><gd name="ht2" fmla="cos hd2 stAng" /><gd name="dx2" fmla="cat2 wd2 ht2 wt2" /><gd name="dy2" fmla="sat2 hd2 ht2 wt2" /><gd name="x2" fmla="+- hc dx2 0" /><gd name="y2" fmla="+- vc dy2 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefAng="adj" minAng="0" maxAng="21599999"><pos x="x1" y="y1" /></ahPolar></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x2" y="y2" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="stAng" swAng="swAng" /></path></pathLst>';
var ul = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 0" /><gd name="adj2" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adval" fmla="pin 0 adj1 21599999" /><gd name="v1" fmla="+- 10800000 0 adval" /><gd name="v2" fmla="+- 32400000 0 adval" /><gd name="nv1" fmla="+- 0 0 v1" /><gd name="stAng" fmla="?: nv1 v2 v1" /><gd name="w1" fmla="+- 5400000 0 adval" /><gd name="w2" fmla="+- 16200000 0 adval" /><gd name="d1" fmla="+- adval 0 stAng" /><gd name="d2" fmla="+- d1 0 21600000" /><gd name="v3" fmla="+- 0 0 10800000" /><gd name="c2" fmla="?: w2 d1 d2" /><gd name="c1" fmla="?: v1 d2 c2" /><gd name="c0" fmla="?: w1 d1 c1" /><gd name="swAng" fmla="?: stAng c0 v3" /><gd name="wt1" fmla="sin wd2 stAng" /><gd name="ht1" fmla="cos hd2 stAng" /><gd name="dx1" fmla="cat2 wd2 ht1 wt1" /><gd name="dy1" fmla="sat2 hd2 ht1 wt1" /><gd name="x1" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc dy1 0" /><gd name="adval2" fmla="pin 0 adj2 99000" /><gd name="ratio" fmla="*/ adval2 1 100000" /><gd name="iwd2" fmla="*/ wd2 ratio 1" /><gd name="ihd2" fmla="*/ hd2 ratio 1" /><gd name="wt2" fmla="sin iwd2 adval" /><gd name="ht2" fmla="cos ihd2 adval" /><gd name="dx2" fmla="cat2 iwd2 ht2 wt2" /><gd name="dy2" fmla="sat2 ihd2 ht2 wt2" /><gd name="x2" fmla="+- hc dx2 0" /><gd name="y2" fmla="+- vc dy2 0" /><gd name="wt3" fmla="sin iwd2 stAng" /><gd name="ht3" fmla="cos ihd2 stAng" /><gd name="dx3" fmla="cat2 iwd2 ht3 wt3" /><gd name="dy3" fmla="sat2 ihd2 ht3 wt3" /><gd name="x3" fmla="+- hc dx3 0" /><gd name="y3" fmla="+- vc dy3 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefR="adj2" minR="0" maxR="100000" gdRefAng="adj1" minAng="0" maxAng="21599999"><pos x="x2" y="y2" /></ahPolar></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x3" y="y3" /></moveTo><arcTo wR="iwd2" hR="ihd2" stAng="stAng" swAng="swAng" /></path><path><moveTo><pt x="x1" y="y1" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="stAng" swAng="swAng" /></path></pathLst>';
var Al = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val cd2" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adval" fmla="pin 0 adj 21599999" /><gd name="v1" fmla="+- 10800000 0 adval" /><gd name="v2" fmla="+- 32400000 0 adval" /><gd name="end" fmla="?: v1 v1 v2" /><gd name="w1" fmla="+- 5400000 0 adval" /><gd name="w2" fmla="+- 16200000 0 adval" /><gd name="d1" fmla="+- end 0 adval" /><gd name="d2" fmla="+- 21600000 d1 0" /><gd name="c2" fmla="?: w2 d1 d2" /><gd name="c1" fmla="?: v1 d2 c2" /><gd name="swAng" fmla="?: w1 d1 c1" /><gd name="wt1" fmla="sin wd2 adj" /><gd name="ht1" fmla="cos hd2 adj" /><gd name="dx1" fmla="cat2 wd2 ht1 wt1" /><gd name="dy1" fmla="sat2 hd2 ht1 wt1" /><gd name="x1" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc dy1 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefAng="adj" minAng="0" maxAng="21599999"><pos x="x1" y="y1" /></ahPolar></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y1" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="adval" swAng="swAng" /></path></pathLst>';
var bl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val cd2" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adval" fmla="pin 0 adj1 21599999" /><gd name="v1" fmla="+- 10800000 0 adval" /><gd name="v2" fmla="+- 32400000 0 adval" /><gd name="end" fmla="?: v1 v1 v2" /><gd name="w1" fmla="+- 5400000 0 adval" /><gd name="w2" fmla="+- 16200000 0 adval" /><gd name="d1" fmla="+- end 0 adval" /><gd name="d2" fmla="+- 21600000 d1 0" /><gd name="c2" fmla="?: w2 d1 d2" /><gd name="c1" fmla="?: v1 d2 c2" /><gd name="swAng" fmla="?: w1 d1 c1" /><gd name="wt1" fmla="sin wd2 adval" /><gd name="ht1" fmla="cos hd2 adval" /><gd name="dx1" fmla="cat2 wd2 ht1 wt1" /><gd name="dy1" fmla="sat2 hd2 ht1 wt1" /><gd name="x1" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc dy1 0" /><gd name="adval2" fmla="pin 0 adj2 99000" /><gd name="ratio" fmla="*/ adval2 1 100000" /><gd name="iwd2" fmla="*/ wd2 ratio 1" /><gd name="ihd2" fmla="*/ hd2 ratio 1" /><gd name="wt2" fmla="sin iwd2 adval" /><gd name="ht2" fmla="cos ihd2 adval" /><gd name="dx2" fmla="cat2 iwd2 ht2 wt2" /><gd name="dy2" fmla="sat2 ihd2 ht2 wt2" /><gd name="x2" fmla="+- hc dx2 0" /><gd name="y2" fmla="+- vc dy2 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefR="adj2" minR="0" maxR="100000" gdRefAng="adj1" minAng="0" maxAng="21599999"><pos x="x2" y="y2" /></ahPolar></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y1" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="adval" swAng="swAng" /></path><path><moveTo><pt x="x2" y="y2" /></moveTo><arcTo wR="iwd2" hR="ihd2" stAng="adval" swAng="swAng" /></path></pathLst>';
var jl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 10800000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adval" fmla="pin 0 adj 21599999" /><gd name="bot" fmla="+- 5400000 0 adval" /><gd name="lef" fmla="+- 10800000 0 adval" /><gd name="top" fmla="+- 16200000 0 adval" /><gd name="rig" fmla="+- 21600000 0 adval" /><gd name="c3" fmla="?: top adval 0" /><gd name="c2" fmla="?: lef 10800000 c3" /><gd name="c1" fmla="?: bot rig c2" /><gd name="stAng" fmla="?: adval c1 0" /><gd name="w1" fmla="+- 21600000 0 stAng" /><gd name="stAngB" fmla="?: stAng w1 0" /><gd name="td1" fmla="*/ bot 2 1" /><gd name="td2" fmla="*/ top 2 1" /><gd name="ntd2" fmla="+- 0 0 td2" /><gd name="w2" fmla="+- 0 0 10800000" /><gd name="c6" fmla="?: top ntd2 w2" /><gd name="c5" fmla="?: lef 10800000 c6" /><gd name="c4" fmla="?: bot td1 c5" /><gd name="v1" fmla="?: adval c4 10800000" /><gd name="swAngT" fmla="+- 0 0 v1" /><gd name="stT" fmla="?: lef stAngB stAng" /><gd name="stB" fmla="?: lef stAng stAngB" /><gd name="swT" fmla="?: lef v1 swAngT" /><gd name="swB" fmla="?: lef swAngT v1" /><gd name="wt1" fmla="sin wd2 stT" /><gd name="ht1" fmla="cos hd2 stT" /><gd name="dx1" fmla="cat2 wd2 ht1 wt1" /><gd name="dy1" fmla="sat2 hd2 ht1 wt1" /><gd name="x1" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc dy1 0" /><gd name="wt2" fmla="sin wd2 stB" /><gd name="ht2" fmla="cos hd2 stB" /><gd name="dx2" fmla="cat2 wd2 ht2 wt2" /><gd name="dy2" fmla="sat2 hd2 ht2 wt2" /><gd name="x2" fmla="+- hc dx2 0" /><gd name="y2" fmla="+- vc dy2 0" /><gd name="wt3" fmla="sin wd2 adj" /><gd name="ht3" fmla="cos hd2 adj" /><gd name="dx3" fmla="cat2 wd2 ht3 wt3" /><gd name="dy3" fmla="sat2 hd2 ht3 wt3" /><gd name="x3" fmla="+- hc dx3 0" /><gd name="y3" fmla="+- vc dy3 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefAng="adj" minAng="0" maxAng="21599999"><pos x="x3" y="y3" /></ahPolar></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y1" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="stT" swAng="swT" /></path><path><moveTo><pt x="l" y="vc" /></moveTo><lnTo><pt x="r" y="vc" /></lnTo></path><path><moveTo><pt x="x2" y="y2" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="stB" swAng="swB" /></path></pathLst>';
var $l = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val cd2" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adval" fmla="pin 0 adj1 21599999" /><gd name="bot" fmla="+- 5400000 0 adval" /><gd name="lef" fmla="+- 10800000 0 adval" /><gd name="top" fmla="+- 16200000 0 adval" /><gd name="rig" fmla="+- 21600000 0 adval" /><gd name="c3" fmla="?: top adval 0" /><gd name="c2" fmla="?: lef 10800000 c3" /><gd name="c1" fmla="?: bot rig c2" /><gd name="stAng" fmla="?: adval c1 0" /><gd name="w1" fmla="+- 21600000 0 stAng" /><gd name="stAngB" fmla="?: stAng w1 0" /><gd name="td1" fmla="*/ bot 2 1" /><gd name="td2" fmla="*/ top 2 1" /><gd name="ntd2" fmla="+- 0 0 td2" /><gd name="w2" fmla="+- 0 0 10800000" /><gd name="c6" fmla="?: top ntd2 w2" /><gd name="c5" fmla="?: lef 10800000 c6" /><gd name="c4" fmla="?: bot td1 c5" /><gd name="v1" fmla="?: adval c4 10800000" /><gd name="swAngT" fmla="+- 0 0 v1" /><gd name="stT" fmla="?: lef stAngB stAng" /><gd name="stB" fmla="?: lef stAng stAngB" /><gd name="swT" fmla="?: lef v1 swAngT" /><gd name="swB" fmla="?: lef swAngT v1" /><gd name="wt1" fmla="sin wd2 stT" /><gd name="ht1" fmla="cos hd2 stT" /><gd name="dx1" fmla="cat2 wd2 ht1 wt1" /><gd name="dy1" fmla="sat2 hd2 ht1 wt1" /><gd name="x1" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc dy1 0" /><gd name="wt6" fmla="sin wd2 stB" /><gd name="ht6" fmla="cos hd2 stB" /><gd name="dx6" fmla="cat2 wd2 ht6 wt6" /><gd name="dy6" fmla="sat2 hd2 ht6 wt6" /><gd name="x6" fmla="+- hc dx6 0" /><gd name="y6" fmla="+- vc dy6 0" /><gd name="adval2" fmla="pin 40000 adj2 99000" /><gd name="ratio" fmla="*/ adval2 1 100000" /><gd name="iwd2" fmla="*/ wd2 ratio 1" /><gd name="ihd2" fmla="*/ hd2 ratio 1" /><gd name="wt2" fmla="sin iwd2 stT" /><gd name="ht2" fmla="cos ihd2 stT" /><gd name="dx2" fmla="cat2 iwd2 ht2 wt2" /><gd name="dy2" fmla="sat2 ihd2 ht2 wt2" /><gd name="x2" fmla="+- hc dx2 0" /><gd name="y2" fmla="+- vc dy2 0" /><gd name="wt5" fmla="sin iwd2 stB" /><gd name="ht5" fmla="cos ihd2 stB" /><gd name="dx5" fmla="cat2 iwd2 ht5 wt5" /><gd name="dy5" fmla="sat2 ihd2 ht5 wt5" /><gd name="x5" fmla="+- hc dx5 0" /><gd name="y5" fmla="+- vc dy5 0" /><gd name="d1" fmla="+- hd2 0 ihd2" /><gd name="d12" fmla="*/ d1 1 2" /><gd name="yu" fmla="+- vc 0 d12" /><gd name="yd" fmla="+- vc d12 0" /><gd name="v1" fmla="*/ d12 d12 1" /><gd name="v2" fmla="*/ ihd2 ihd2 1" /><gd name="v3" fmla="*/ v1 1 v2" /><gd name="v4" fmla="+- 1 0 v3" /><gd name="v5" fmla="*/ iwd2 iwd2 1" /><gd name="v6" fmla="*/ v4 v5 1" /><gd name="v7" fmla="sqrt v6" /><gd name="xl" fmla="+- hc 0 v7" /><gd name="xr" fmla="+- hc v7 0" /><gd name="wtadj" fmla="sin iwd2 adj1" /><gd name="htadj" fmla="cos ihd2 adj1" /><gd name="dxadj" fmla="cat2 iwd2 htadj wtadj" /><gd name="dyadj" fmla="sat2 ihd2 htadj wtadj" /><gd name="xadj" fmla="+- hc dxadj 0" /><gd name="yadj" fmla="+- vc dyadj 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefR="adj2" minR="0" maxR="100000" gdRefAng="adj1" minAng="0" maxAng="21599999"><pos x="xadj" y="yadj" /></ahPolar></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y1" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="stT" swAng="swT" /></path><path><moveTo><pt x="x2" y="y2" /></moveTo><arcTo wR="iwd2" hR="ihd2" stAng="stT" swAng="swT" /></path><path><moveTo><pt x="xl" y="yu" /></moveTo><lnTo><pt x="xr" y="yu" /></lnTo></path><path><moveTo><pt x="xl" y="yd" /></moveTo><lnTo><pt x="xr" y="yd" /></lnTo></path><path><moveTo><pt x="x5" y="y5" /></moveTo><arcTo wR="iwd2" hR="ihd2" stAng="stB" swAng="swB" /></path><path><moveTo><pt x="x6" y="y6" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="stB" swAng="swB" /></path></pathLst>';
var Rl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 14286" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 33333" /><gd name="dy" fmla="*/ a h 100000" /><gd name="y0" fmla="+- t dy 0" /><gd name="y1" fmla="+- b 0 dy" /><gd name="ncd2" fmla="*/ cd2 -1 1" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="33333"><pos x="hc" y="y0" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><arcTo wR="wd2" hR="dy" stAng="cd2" swAng="ncd2" /></path><path><moveTo><pt x="l" y="y1" /></moveTo><arcTo wR="wd2" hR="dy" stAng="cd2" swAng="ncd2" /></path></pathLst>';
var Yl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 85714" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 66667 adj 100000" /><gd name="dy1" fmla="*/ a h 100000" /><gd name="dy" fmla="+- h 0 dy1" /><gd name="y0" fmla="+- t dy1 0" /><gd name="y1" fmla="+- t dy 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="66667" maxY="100000"><pos x="hc" y="y0" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y1" /></moveTo><arcTo wR="wd2" hR="dy" stAng="cd2" swAng="cd2" /></path><path><moveTo><pt x="l" y="b" /></moveTo><arcTo wR="wd2" hR="dy" stAng="cd2" swAng="cd2" /></path></pathLst>';
var Xl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 44444" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 28570 adj 100000" /><gd name="dy" fmla="*/ a h 100000" /><gd name="y1" fmla="+- t dy 0" /><gd name="dy2" fmla="+- h 0 dy" /><gd name="dy3" fmla="*/ dy2 1 4" /><gd name="y2" fmla="+- t dy3 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="28570" maxY="100000"><pos x="l" y="y1" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="y2" /></lnTo></path><path><moveTo><pt x="l" y="y1" /></moveTo><lnTo><pt x="r" y="b" /></lnTo></path></pathLst>';
var Cl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 44444" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 28570 adj 100000" /><gd name="dy" fmla="*/ a h 100000" /><gd name="y1" fmla="+- t dy 0" /><gd name="dy2" fmla="+- h 0 dy" /><gd name="dy3" fmla="*/ dy2 1 4" /><gd name="y2" fmla="+- t dy3 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="28570" maxY="100000"><pos x="r" y="y1" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y2" /></moveTo><lnTo><pt x="r" y="t" /></lnTo></path><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="r" y="y1" /></lnTo></path></pathLst>';
var Fl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="y" fmla="*/ a h 100000" /><gd name="y1" fmla="+- t b y" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="50000"><pos x="l" y="y" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y" /></moveTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="r" y="y" /></lnTo></path><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="hc" y="y1" /></lnTo><lnTo><pt x="r" y="b" /></lnTo></path></pathLst>';
var Bl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 75000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 50000 adj 100000" /><gd name="y" fmla="*/ a h 100000" /><gd name="y1" fmla="+- b 0 y" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="50000" maxY="100000"><pos x="l" y="y" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="hc" y="y1" /></lnTo><lnTo><pt x="r" y="t" /></lnTo></path><path><moveTo><pt x="l" y="y" /></moveTo><lnTo><pt x="hc" y="b" /></lnTo><lnTo><pt x="r" y="y" /></lnTo></path></pathLst>';
var kl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 10800000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adval" fmla="pin 0 adj 21599999" /><gd name="d0" fmla="+- adval 0 10800000" /><gd name="d1" fmla="+- 10800000 0 adval" /><gd name="d2" fmla="+- 21600000 0 adval" /><gd name="d3" fmla="?: d1 d1 10799999" /><gd name="d4" fmla="?: d0 d2 d3" /><gd name="swAng" fmla="*/ d4 2 1" /><gd name="wt1" fmla="sin wd2 adj" /><gd name="ht1" fmla="cos hd2 adj" /><gd name="dx1" fmla="cat2 wd2 ht1 wt1" /><gd name="dy1" fmla="sat2 hd2 ht1 wt1" /><gd name="x1" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc dy1 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefAng="adj" minAng="0" maxAng="21599999"><pos x="x1" y="y1" /></ahPolar></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y1" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="adval" swAng="swAng" /></path></pathLst>';
var ql = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val cd2" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adval" fmla="pin 0 adj1 21599999" /><gd name="d0" fmla="+- adval 0 10800000" /><gd name="d1" fmla="+- 10800000 0 adval" /><gd name="d2" fmla="+- 21600000 0 adval" /><gd name="d3" fmla="?: d1 d1 10799999" /><gd name="d4" fmla="?: d0 d2 d3" /><gd name="swAng" fmla="*/ d4 2 1" /><gd name="wt1" fmla="sin wd2 adval" /><gd name="ht1" fmla="cos hd2 adval" /><gd name="dx1" fmla="cat2 wd2 ht1 wt1" /><gd name="dy1" fmla="sat2 hd2 ht1 wt1" /><gd name="x1" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc dy1 0" /><gd name="adval2" fmla="pin 0 adj2 99000" /><gd name="ratio" fmla="*/ adval2 1 100000" /><gd name="iwd2" fmla="*/ wd2 ratio 1" /><gd name="ihd2" fmla="*/ hd2 ratio 1" /><gd name="wt2" fmla="sin iwd2 adval" /><gd name="ht2" fmla="cos ihd2 adval" /><gd name="dx2" fmla="cat2 iwd2 ht2 wt2" /><gd name="dy2" fmla="sat2 ihd2 ht2 wt2" /><gd name="x2" fmla="+- hc dx2 0" /><gd name="y2" fmla="+- vc dy2 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahPolar gdRefR="adj2" minR="0" maxR="100000" gdRefAng="adj1" minAng="0" maxAng="21599999"><pos x="x2" y="y2" /></ahPolar></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="y1" /></moveTo><arcTo wR="wd2" hR="hd2" stAng="adval" swAng="swAng" /></path><path><moveTo><pt x="x2" y="y2" /></moveTo><arcTo wR="iwd2" hR="ihd2" stAng="adval" swAng="swAng" /></path></pathLst>';
var Ml = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 45977" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 56338" /><gd name="dy" fmla="*/ a h 100000" /><gd name="gd1" fmla="*/ dy 3 4" /><gd name="gd2" fmla="*/ dy 5 4" /><gd name="gd3" fmla="*/ dy 3 8" /><gd name="gd4" fmla="*/ dy 1 8" /><gd name="gd5" fmla="+- h 0 gd3" /><gd name="gd6" fmla="+- gd4 h 0" /><gd name="y0" fmla="+- t dy 0" /><gd name="y1" fmla="+- t gd1 0" /><gd name="y2" fmla="+- t gd2 0" /><gd name="y3" fmla="+- t gd3 0" /><gd name="y4" fmla="+- t gd4 0" /><gd name="y5" fmla="+- t gd5 0" /><gd name="y6" fmla="+- t gd6 0" /><gd name="x1" fmla="+- l wd3 0" /><gd name="x2" fmla="+- r 0 wd3" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="56338"><pos x="r" y="y0" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><cubicBezTo><pt x="x1" y="y1" /><pt x="x2" y="y2" /><pt x="r" y="y0" /></cubicBezTo></path><path><moveTo><pt x="l" y="y5" /></moveTo><cubicBezTo><pt x="x1" y="y6" /><pt x="x2" y="y6" /><pt x="r" y="y5" /></cubicBezTo></path></pathLst>';
var Pl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 45977" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 56338" /><gd name="dy" fmla="*/ a h 100000" /><gd name="gd1" fmla="*/ dy 3 4" /><gd name="gd2" fmla="*/ dy 5 4" /><gd name="gd3" fmla="*/ dy 3 8" /><gd name="gd4" fmla="*/ dy 1 8" /><gd name="gd5" fmla="+- h 0 gd3" /><gd name="gd6" fmla="+- gd4 h 0" /><gd name="y0" fmla="+- t dy 0" /><gd name="y1" fmla="+- t gd1 0" /><gd name="y2" fmla="+- t gd2 0" /><gd name="y3" fmla="+- t gd3 0" /><gd name="y4" fmla="+- t gd4 0" /><gd name="y5" fmla="+- t gd5 0" /><gd name="y6" fmla="+- t gd6 0" /><gd name="x1" fmla="+- l wd3 0" /><gd name="x2" fmla="+- r 0 wd3" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="56338"><pos x="l" y="y0" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y0" /></moveTo><cubicBezTo><pt x="x1" y="y2" /><pt x="x2" y="y1" /><pt x="r" y="t" /></cubicBezTo></path><path><moveTo><pt x="l" y="y5" /></moveTo><cubicBezTo><pt x="x1" y="y6" /><pt x="x2" y="y6" /><pt x="r" y="y5" /></cubicBezTo></path></pathLst>';
var Sl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 18750" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 37500" /><gd name="dy" fmla="*/ a ss 100000" /><gd name="gd0" fmla="*/ dy 4 3" /><gd name="gd1" fmla="+- h 0 gd0" /><gd name="adjY" fmla="+- t dy 0" /><gd name="y0" fmla="+- t gd0 0" /><gd name="y1" fmla="+- t gd1 0" /><gd name="x0" fmla="+- l wd3 0" /><gd name="x1" fmla="+- r 0 wd3" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="37500"><pos x="hc" y="adjY" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><cubicBezTo><pt x="x0" y="y0" /><pt x="x1" y="y0" /><pt x="r" y="t" /></cubicBezTo></path><path><moveTo><pt x="l" y="b" /></moveTo><cubicBezTo><pt x="x0" y="y1" /><pt x="x1" y="y1" /><pt x="r" y="b" /></cubicBezTo></path></pathLst>';
var Ol = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 6250 adj 100000" /><gd name="dy" fmla="*/ a ss 100000" /><gd name="dy2" fmla="+- h 0 dy" /><gd name="y1" fmla="+- t dy 0" /><gd name="cp" fmla="+- y1 0 dy2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="6250" maxY="100000"><pos x="hc" y="y1" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo></path><path><moveTo><pt x="l" y="b" /></moveTo><quadBezTo><pt x="hc" y="cp" /><pt x="r" y="b" /></quadBezTo></path></pathLst>';
var Il = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 35000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 5000 adj 95000" /><gd name="dy" fmla="*/ a h 100000" /><gd name="del" fmla="*/ h 5 100" /><gd name="dh1" fmla="*/ h 45 100" /><gd name="dh2" fmla="*/ h 55 100" /><gd name="yh" fmla="+- dy 0 del" /><gd name="yl" fmla="+- dy del 0" /><gd name="y3" fmla="+- yh yh dh1" /><gd name="y4" fmla="+- yl yl dh2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="5000" maxY="95000"><pos x="hc" y="dy" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo></path><path><moveTo><pt x="l" y="dh1" /></moveTo><quadBezTo><pt x="hc" y="y3" /><pt x="r" y="dh1" /></quadBezTo></path><path><moveTo><pt x="l" y="dh2" /></moveTo><quadBezTo><pt x="hc" y="y4" /><pt x="r" y="dh2" /></quadBezTo></path><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="r" y="b" /></lnTo></path></pathLst>';
var Dl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 3000 adj 47000" /><gd name="dy" fmla="*/ a h 100000" /><gd name="del" fmla="*/ h 3 100" /><gd name="ey1" fmla="*/ h 30 100" /><gd name="ey2" fmla="*/ h 36 100" /><gd name="ey3" fmla="*/ h 63 100" /><gd name="ey4" fmla="*/ h 70 100" /><gd name="by" fmla="+- b 0 dy" /><gd name="yh1" fmla="+- dy 0 del" /><gd name="yl1" fmla="+- dy del 0" /><gd name="yh2" fmla="+- by 0 del" /><gd name="yl2" fmla="+- by del 0" /><gd name="y1" fmla="+- yh1 yh1 ey1" /><gd name="y2" fmla="+- yl1 yl1 ey2" /><gd name="y3" fmla="+- yh2 yh2 ey3" /><gd name="y4" fmla="+- yl2 yl2 ey4" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="3000" maxY="47000"><pos x="hc" y="dy" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo></path><path><moveTo><pt x="l" y="ey1" /></moveTo><quadBezTo><pt x="hc" y="y1" /><pt x="r" y="ey1" /></quadBezTo></path><path><moveTo><pt x="l" y="ey2" /></moveTo><quadBezTo><pt x="hc" y="y2" /><pt x="r" y="ey2" /></quadBezTo></path><path><moveTo><pt x="l" y="ey3" /></moveTo><quadBezTo><pt x="hc" y="y3" /><pt x="r" y="ey3" /></quadBezTo></path><path><moveTo><pt x="l" y="ey4" /></moveTo><quadBezTo><pt x="hc" y="y4" /><pt x="r" y="ey4" /></quadBezTo></path><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="r" y="b" /></lnTo></path></pathLst>';
var El = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 93750" /><gd name="dy" fmla="*/ a h 100000" /><gd name="y1" fmla="+- t dy 0" /><gd name="cp" fmla="+- y1 dy 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="93750"><pos x="hc" y="y1" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><quadBezTo><pt x="hc" y="cp" /><pt x="r" y="t" /></quadBezTo></path><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="r" y="b" /></lnTo></path></pathLst>';
var zl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 6250" /><gd name="adj2" fmla="val 0" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 12500" /><gd name="a2" fmla="pin -10000 adj2 10000" /><gd name="y1" fmla="*/ h a1 100000" /><gd name="dy2" fmla="*/ y1 10 3" /><gd name="y2" fmla="+- y1 0 dy2" /><gd name="y3" fmla="+- y1 dy2 0" /><gd name="y4" fmla="+- b 0 y1" /><gd name="y5" fmla="+- y4 0 dy2" /><gd name="y6" fmla="+- y4 dy2 0" /><gd name="of" fmla="*/ w a2 100000" /><gd name="of2" fmla="*/ w a2 50000" /><gd name="x1" fmla="abs of" /><gd name="dx2" fmla="?: of2 0 of2" /><gd name="x2" fmla="+- l 0 dx2" /><gd name="dx8" fmla="?: of2 of2 0" /><gd name="x8" fmla="+- r 0 dx8" /><gd name="dx3" fmla="+/ dx2 x8 6" /><gd name="x3" fmla="+- x2 dx3 0" /><gd name="dx4" fmla="+/ dx2 x8 3" /><gd name="x4" fmla="+- x2 dx4 0" /><gd name="x5" fmla="+/ x2 x8 2" /><gd name="x6" fmla="+- x5 dx3 0" /><gd name="x7" fmla="+/ x6 x8 2" /><gd name="x9" fmla="+- l dx8 0" /><gd name="x15" fmla="+- r dx2 0" /><gd name="x10" fmla="+- x9 dx3 0" /><gd name="x11" fmla="+- x9 dx4 0" /><gd name="x12" fmla="+/ x9 x15 2" /><gd name="x13" fmla="+- x12 dx3 0" /><gd name="x14" fmla="+/ x13 x15 2" /><gd name="x16" fmla="+- r 0 x1" /><gd name="xAdj" fmla="+- hc of 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="12500"><pos x="l" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="-10000" maxX="10000"><pos x="xAdj" y="b" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x2" y="y1" /></moveTo><cubicBezTo><pt x="x3" y="y2" /><pt x="x4" y="y3" /><pt x="x5" y="y1" /></cubicBezTo><cubicBezTo><pt x="x6" y="y2" /><pt x="x7" y="y3" /><pt x="x8" y="y1" /></cubicBezTo></path><path><moveTo><pt x="x9" y="y4" /></moveTo><cubicBezTo><pt x="x10" y="y5" /><pt x="x11" y="y6" /><pt x="x12" y="y4" /></cubicBezTo><cubicBezTo><pt x="x13" y="y5" /><pt x="x14" y="y6" /><pt x="x15" y="y4" /></cubicBezTo></path></pathLst>';
var Gl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 33333" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 49999" /><gd name="dx" fmla="*/ a w 100000" /><gd name="x1" fmla="+- l dx 0" /><gd name="x2" fmla="+- r 0 dx" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="49999"><pos x="x1" y="b" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo></path><path><moveTo><pt x="x1" y="b" /></moveTo><lnTo><pt x="x2" y="b" /></lnTo></path></pathLst>';
var Hl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 33333" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 49999" /><gd name="dy" fmla="*/ a h 100000" /><gd name="y1" fmla="+- t dy 0" /><gd name="y2" fmla="+- b 0 dy" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="49999"><pos x="l" y="y1" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y1" /></moveTo><lnTo><pt x="r" y="t" /></lnTo></path><path><moveTo><pt x="l" y="y2" /></moveTo><lnTo><pt x="r" y="b" /></lnTo></path></pathLst>';
var Nl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 33333" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 49999" /><gd name="dy" fmla="*/ a h 100000" /><gd name="y1" fmla="+- t dy 0" /><gd name="y2" fmla="+- b 0 dy" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="49999"><pos x="r" y="y1" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="y1" /></lnTo></path><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="r" y="y2" /></lnTo></path></pathLst>';
var Zl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 33333" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 49999" /><gd name="dx" fmla="*/ a w 100000" /><gd name="x1" fmla="+- l dx 0" /><gd name="x2" fmla="+- r 0 dx" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="49999"><pos x="x1" y="t" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x1" y="t" /></moveTo><lnTo><pt x="x2" y="t" /></lnTo></path><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="r" y="b" /></lnTo></path></pathLst>';
var _l = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 18750" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 20000" /><gd name="dy" fmla="*/ a h 100000" /><gd name="gd" fmla="*/ dy 1 3" /><gd name="gd0" fmla="+- 0 0 gd" /><gd name="gd1" fmla="+- h 0 gd0" /><gd name="ty" fmla="+- t dy 0" /><gd name="by" fmla="+- b 0 dy" /><gd name="y0" fmla="+- t gd0 0" /><gd name="y1" fmla="+- t gd1 0" /><gd name="x0" fmla="+- l wd3 0" /><gd name="x1" fmla="+- r 0 wd3" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="20000"><pos x="l" y="ty" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="ty" /></moveTo><cubicBezTo><pt x="x0" y="y0" /><pt x="x1" y="y0" /><pt x="r" y="ty" /></cubicBezTo></path><path><moveTo><pt x="l" y="by" /></moveTo><cubicBezTo><pt x="x0" y="y1" /><pt x="x1" y="y1" /><pt x="r" y="by" /></cubicBezTo></path></pathLst>';
var Vl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 60000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 60000 adj 100000" /><gd name="dy" fmla="*/ a h 100000" /><gd name="ty" fmla="+- t dy 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="60000" maxY="100000"><pos x="l" y="ty" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo></path><path><moveTo><pt x="l" y="ty" /></moveTo><quadBezTo><pt x="hc" y="b" /><pt x="r" y="ty" /></quadBezTo></path></pathLst>';
var Wl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 40000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 50000" /><gd name="dy" fmla="*/ a h 100000" /><gd name="ty" fmla="+- t dy 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="50000"><pos x="l" y="ty" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="ty" /></moveTo><quadBezTo><pt x="hc" y="t" /><pt x="r" y="ty" /></quadBezTo></path><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="r" y="b" /></lnTo></path></pathLst>';
var Ql = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 30000 adj 70000" /><gd name="mid" fmla="*/ a w 100000" /><gd name="midDir" fmla="+- mid 0 hc" /><gd name="dl" fmla="+- mid 0 l" /><gd name="dr" fmla="+- r 0 mid" /><gd name="dl2" fmla="*/ dl 2 1" /><gd name="dr2" fmla="*/ dr 2 1" /><gd name="dx" fmla="?: midDir dr2 dl2" /><gd name="xr" fmla="+- l dx 0" /><gd name="xl" fmla="+- r 0 dx" /><gd name="tlx" fmla="?: midDir l xl" /><gd name="trx" fmla="?: midDir xr r" /><gd name="blx" fmla="?: midDir xl l" /><gd name="brx" fmla="?: midDir r xr" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="30000" maxX="70000"><pos x="mid" y="b" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="tlx" y="t" /></moveTo><lnTo><pt x="trx" y="t" /></lnTo></path><path><moveTo><pt x="blx" y="b" /></moveTo><lnTo><pt x="brx" y="b" /></lnTo></path></pathLst>';
var Ul = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 60000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 50000 adj 99000" /><gd name="dy" fmla="*/ a h 100000" /><gd name="y" fmla="+- t dy 0" /><gd name="r" fmla="*/ dy 1 2" /><gd name="y1" fmla="+- t r 0" /><gd name="y2" fmla="+- b 0 r" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="50000" maxY="99000"><pos x="hc" y="y" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y1" /></moveTo><arcTo wR="wd2" hR="r" stAng="10800000" swAng="21599999" /></path><path><moveTo><pt x="l" y="y2" /></moveTo><arcTo wR="wd2" hR="r" stAng="10800000" swAng="21599999" /></path></pathLst>';
var Kl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 60000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 50000 adj 99000" /><gd name="dy" fmla="*/ a h 100000" /><gd name="y" fmla="+- t dy 0" /><gd name="r" fmla="*/ dy 1 2" /><gd name="y1" fmla="+- t r 0" /><gd name="y2" fmla="+- b 0 r" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="50000" maxY="99000"><pos x="hc" y="y" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y1" /></moveTo><arcTo wR="wd2" hR="r" stAng="10800000" swAng="-21599999" /></path><path><moveTo><pt x="l" y="y2" /></moveTo><arcTo wR="wd2" hR="r" stAng="10800000" swAng="-21599999" /></path></pathLst>';
var Jl = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 44445" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 28569 adj 100000" /><gd name="dy" fmla="*/ a h 100000" /><gd name="y1" fmla="+- t dy 0" /><gd name="y2" fmla="+- b 0 dy" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="28569" maxY="100000"><pos x="l" y="y1" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="y2" /></lnTo></path><path><moveTo><pt x="l" y="y1" /></moveTo><lnTo><pt x="r" y="b" /></lnTo></path></pathLst>';
var as = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 55555" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 71431" /><gd name="dy" fmla="*/ a h 100000" /><gd name="y1" fmla="+- t dy 0" /><gd name="y2" fmla="+- b 0 dy" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="71431"><pos x="l" y="y1" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y1" /></moveTo><lnTo><pt x="r" y="t" /></lnTo></path><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="r" y="y2" /></lnTo></path></pathLst>';
var ns = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 14286 adj 50000" /><gd name="dx" fmla="*/ w 1 3" /><gd name="dy" fmla="*/ a h 100000" /><gd name="x1" fmla="+- l dx 0" /><gd name="x2" fmla="+- r 0 dx" /><gd name="y1" fmla="+- t dy 0" /><gd name="y2" fmla="+- b 0 dy" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="14286" maxY="50000"><pos x="l" y="dy" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y1" /></moveTo><lnTo><pt x="x1" y="t" /></lnTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="r" y="y1" /></lnTo></path><path><moveTo><pt x="l" y="y2" /></moveTo><lnTo><pt x="x1" y="b" /></lnTo><lnTo><pt x="x2" y="b" /></lnTo><lnTo><pt x="r" y="y2" /></lnTo></path></pathLst>';
var ms = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 100000" /><gd name="y" fmla="*/ a h 100000" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="100000"><pos x="l" y="y" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y" /></moveTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="r" y="y" /></lnTo></path><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="r" y="b" /></lnTo></path></pathLst>';
var ts = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 100000" /><gd name="y" fmla="*/ a h 100000" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="100000"><pos x="l" y="y" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="r" y="t" /></lnTo></path><path><moveTo><pt x="l" y="y" /></moveTo><lnTo><pt x="hc" y="b" /></lnTo><lnTo><pt x="r" y="y" /></lnTo></path></pathLst>';
var os = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 12500" /><gd name="adj2" fmla="val 0" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 20000" /><gd name="a2" fmla="pin -10000 adj2 10000" /><gd name="y1" fmla="*/ h a1 100000" /><gd name="dy2" fmla="*/ y1 10 3" /><gd name="y2" fmla="+- y1 0 dy2" /><gd name="y3" fmla="+- y1 dy2 0" /><gd name="y4" fmla="+- b 0 y1" /><gd name="y5" fmla="+- y4 0 dy2" /><gd name="y6" fmla="+- y4 dy2 0" /><gd name="of" fmla="*/ w a2 100000" /><gd name="of2" fmla="*/ w a2 50000" /><gd name="x1" fmla="abs of" /><gd name="dx2" fmla="?: of2 0 of2" /><gd name="x2" fmla="+- l 0 dx2" /><gd name="dx5" fmla="?: of2 of2 0" /><gd name="x5" fmla="+- r 0 dx5" /><gd name="dx3" fmla="+/ dx2 x5 3" /><gd name="x3" fmla="+- x2 dx3 0" /><gd name="x4" fmla="+/ x3 x5 2" /><gd name="x6" fmla="+- l dx5 0" /><gd name="x10" fmla="+- r dx2 0" /><gd name="x7" fmla="+- x6 dx3 0" /><gd name="x8" fmla="+/ x7 x10 2" /><gd name="x9" fmla="+- r 0 x1" /><gd name="xAdj" fmla="+- hc of 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="20000"><pos x="l" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="-10000" maxX="10000"><pos x="xAdj" y="b" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x2" y="y1" /></moveTo><cubicBezTo><pt x="x3" y="y2" /><pt x="x4" y="y3" /><pt x="x5" y="y1" /></cubicBezTo></path><path><moveTo><pt x="x6" y="y4" /></moveTo><cubicBezTo><pt x="x7" y="y5" /><pt x="x8" y="y6" /><pt x="x10" y="y4" /></cubicBezTo></path></pathLst>';
var ls = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 12500" /><gd name="adj2" fmla="val 0" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 20000" /><gd name="a2" fmla="pin -10000 adj2 10000" /><gd name="y1" fmla="*/ h a1 100000" /><gd name="dy2" fmla="*/ y1 10 3" /><gd name="y2" fmla="+- y1 0 dy2" /><gd name="y3" fmla="+- y1 dy2 0" /><gd name="y4" fmla="+- b 0 y1" /><gd name="y5" fmla="+- y4 0 dy2" /><gd name="y6" fmla="+- y4 dy2 0" /><gd name="of" fmla="*/ w a2 100000" /><gd name="of2" fmla="*/ w a2 50000" /><gd name="x1" fmla="abs of" /><gd name="dx2" fmla="?: of2 0 of2" /><gd name="x2" fmla="+- l 0 dx2" /><gd name="dx5" fmla="?: of2 of2 0" /><gd name="x5" fmla="+- r 0 dx5" /><gd name="dx3" fmla="+/ dx2 x5 3" /><gd name="x3" fmla="+- x2 dx3 0" /><gd name="x4" fmla="+/ x3 x5 2" /><gd name="x6" fmla="+- l dx5 0" /><gd name="x10" fmla="+- r dx2 0" /><gd name="x7" fmla="+- x6 dx3 0" /><gd name="x8" fmla="+/ x7 x10 2" /><gd name="x9" fmla="+- r 0 x1" /><gd name="xAdj" fmla="+- hc of 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="20000"><pos x="l" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="-10000" maxX="10000"><pos x="xAdj" y="b" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x2" y="y1" /></moveTo><cubicBezTo><pt x="x3" y="y3" /><pt x="x4" y="y2" /><pt x="x5" y="y1" /></cubicBezTo></path><path><moveTo><pt x="x6" y="y4" /></moveTo><cubicBezTo><pt x="x7" y="y6" /><pt x="x8" y="y5" /><pt x="x10" y="y4" /></cubicBezTo></path></pathLst>';
var ss = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 6250" /><gd name="adj2" fmla="val 0" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 12500" /><gd name="a2" fmla="pin -10000 adj2 10000" /><gd name="y1" fmla="*/ h a1 100000" /><gd name="dy2" fmla="*/ y1 10 3" /><gd name="y2" fmla="+- y1 0 dy2" /><gd name="y3" fmla="+- y1 dy2 0" /><gd name="y4" fmla="+- b 0 y1" /><gd name="y5" fmla="+- y4 0 dy2" /><gd name="y6" fmla="+- y4 dy2 0" /><gd name="of" fmla="*/ w a2 100000" /><gd name="of2" fmla="*/ w a2 50000" /><gd name="x1" fmla="abs of" /><gd name="dx2" fmla="?: of2 0 of2" /><gd name="x2" fmla="+- l 0 dx2" /><gd name="dx8" fmla="?: of2 of2 0" /><gd name="x8" fmla="+- r 0 dx8" /><gd name="dx3" fmla="+/ dx2 x8 6" /><gd name="x3" fmla="+- x2 dx3 0" /><gd name="dx4" fmla="+/ dx2 x8 3" /><gd name="x4" fmla="+- x2 dx4 0" /><gd name="x5" fmla="+/ x2 x8 2" /><gd name="x6" fmla="+- x5 dx3 0" /><gd name="x7" fmla="+/ x6 x8 2" /><gd name="x9" fmla="+- l dx8 0" /><gd name="x15" fmla="+- r dx2 0" /><gd name="x10" fmla="+- x9 dx3 0" /><gd name="x11" fmla="+- x9 dx4 0" /><gd name="x12" fmla="+/ x9 x15 2" /><gd name="x13" fmla="+- x12 dx3 0" /><gd name="x14" fmla="+/ x13 x15 2" /><gd name="x16" fmla="+- r 0 x1" /><gd name="xAdj" fmla="+- hc of 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="12500"><pos x="l" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="-10000" maxX="10000"><pos x="xAdj" y="b" /></ahXY></ahLst><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x2" y="y1" /></moveTo><cubicBezTo><pt x="x3" y="y3" /><pt x="x4" y="y2" /><pt x="x5" y="y1" /></cubicBezTo><cubicBezTo><pt x="x6" y="y3" /><pt x="x7" y="y2" /><pt x="x8" y="y1" /></cubicBezTo></path><path><moveTo><pt x="x9" y="y4" /></moveTo><cubicBezTo><pt x="x10" y="y6" /><pt x="x11" y="y5" /><pt x="x12" y="y4" /></cubicBezTo><cubicBezTo><pt x="x13" y="y6" /><pt x="x14" y="y5" /><pt x="x15" y="y4" /></cubicBezTo></path></pathLst>';
var es = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 25000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj" fmla="*/ 50000 w ss" /><gd name="a" fmla="pin 0 adj maxAdj" /><gd name="x1" fmla="*/ ss a 200000" /><gd name="x2" fmla="*/ ss a 100000" /><gd name="x3" fmla="+- r 0 x2" /><gd name="x4" fmla="+- r 0 x1" /><gd name="il" fmla="*/ wd3 a maxAdj" /><gd name="it" fmla="*/ hd3 a maxAdj" /><gd name="ir" fmla="+- r 0 il" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="maxAdj"><pos x="x2" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="x1" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="x4" y="vc" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="x3" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><close /></path></pathLst>';
var ds = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 100000" /><gd name="x1" fmla="*/ w a 200000" /><gd name="x2" fmla="*/ w a 100000" /><gd name="x3" fmla="+- x1 wd2 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj" minX="0" maxX="100000"><pos x="x2" y="t" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="x2" y="t" /></cxn><cxn ang="cd2"><pos x="x1" y="vc" /></cxn><cxn ang="cd4"><pos x="l" y="b" /></cxn><cxn ang="cd4"><pos x="x2" y="b" /></cxn><cxn ang="cd4"><pos x="r" y="b" /></cxn><cxn ang="0"><pos x="x3" y="vc" /></cxn></cxnLst><rect l="x1" t="vc" r="x3" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><close /></path></pathLst>';
var xs = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 50000" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 100000 h ss" /><gd name="a1" fmla="pin 0 adj1 100000" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="dy1" fmla="*/ ss a2 100000" /><gd name="y1" fmla="+- t dy1 0" /><gd name="dx1" fmla="*/ w a1 200000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc dx1 0" /><gd name="dy2" fmla="*/ x1 dy1 wd2" /><gd name="y2" fmla="+- y1 dy2 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="100000"><pos x="x1" y="b" /></ahXY><ahXY gdRefY="adj2" minY="0" maxY="maxAdj2"><pos x="l" y="y1" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="l" y="y1" /></cxn><cxn ang="cd4"><pos x="hc" y="t" /></cxn><cxn ang="0"><pos x="r" y="y1" /></cxn></cxnLst><rect l="x1" t="y2" r="x2" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y1" /></moveTo><lnTo><pt x="x1" y="y1" /></lnTo><lnTo><pt x="x1" y="b" /></lnTo><lnTo><pt x="x2" y="b" /></lnTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="r" y="y1" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><close /></path></pathLst>';
var gs = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 25000" /><gd name="adj3" fmla="val 25000" /><gd name="adj4" fmla="val 64977" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 50000 w ss" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="maxAdj1" fmla="*/ a2 2 1" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="maxAdj3" fmla="*/ 100000 h ss" /><gd name="a3" fmla="pin 0 adj3 maxAdj3" /><gd name="q2" fmla="*/ a3 ss h" /><gd name="maxAdj4" fmla="+- 100000 0 q2" /><gd name="a4" fmla="pin 0 adj4 maxAdj4" /><gd name="dx1" fmla="*/ ss a2 100000" /><gd name="dx2" fmla="*/ ss a1 200000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- hc dx2 0" /><gd name="x4" fmla="+- hc dx1 0" /><gd name="y1" fmla="*/ ss a3 100000" /><gd name="dy2" fmla="*/ h a4 100000" /><gd name="y2" fmla="+- b 0 dy2" /><gd name="y3" fmla="+/ y2 b 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="maxAdj1"><pos x="x2" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="maxAdj2"><pos x="x1" y="t" /></ahXY><ahXY gdRefY="adj3" minY="0" maxY="maxAdj3"><pos x="r" y="y1" /></ahXY><ahXY gdRefY="adj4" minY="0" maxY="maxAdj4"><pos x="l" y="y2" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="y2" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="y2" /></cxn></cxnLst><rect l="l" t="y2" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y2" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="x1" y="y1" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="x4" y="y1" /></lnTo><lnTo><pt x="x3" y="y1" /></lnTo><lnTo><pt x="x3" y="y2" /></lnTo><lnTo><pt x="r" y="y2" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><close /></path></pathLst>';
var cs = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 50000" /><gd name="adj2" fmla="val 50000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 50000 h ss" /><gd name="a1" fmla="pin 0 adj1 100000" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="y2" fmla="*/ ss a2 100000" /><gd name="y3" fmla="+- b 0 y2" /><gd name="dx1" fmla="*/ w a1 200000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc dx1 0" /><gd name="dy1" fmla="*/ x1 y2 wd2" /><gd name="y1" fmla="+- y2 0 dy1" /><gd name="y4" fmla="+- y3 dy1 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="100000"><pos x="x1" y="y3" /></ahXY><ahXY gdRefY="adj2" minY="0" maxY="maxAdj2"><pos x="l" y="y2" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="y2" /></cxn><cxn ang="cd2"><pos x="x1" y="vc" /></cxn><cxn ang="cd2"><pos x="l" y="y3" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="y3" /></cxn><cxn ang="0"><pos x="x2" y="vc" /></cxn><cxn ang="0"><pos x="r" y="y2" /></cxn></cxnLst><rect l="x1" t="y1" r="x2" b="y4" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y2" /></moveTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="r" y="y2" /></lnTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x2" y="y3" /></lnTo><lnTo><pt x="r" y="y3" /></lnTo><lnTo><pt x="hc" y="b" /></lnTo><lnTo><pt x="l" y="y3" /></lnTo><lnTo><pt x="x1" y="y3" /></lnTo><lnTo><pt x="x1" y="y2" /></lnTo><close /></path></pathLst>';
var rs = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 25000" /><gd name="adj3" fmla="val 25000" /><gd name="adj4" fmla="val 48123" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="maxAdj2" fmla="*/ 50000 w ss" /><gd name="a2" fmla="pin 0 adj2 maxAdj2" /><gd name="maxAdj1" fmla="*/ a2 2 1" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="maxAdj3" fmla="*/ 50000 h ss" /><gd name="a3" fmla="pin 0 adj3 maxAdj3" /><gd name="q2" fmla="*/ a3 ss hd2" /><gd name="maxAdj4" fmla="+- 100000 0 q2" /><gd name="a4" fmla="pin 0 adj4 maxAdj4" /><gd name="dx1" fmla="*/ ss a2 100000" /><gd name="dx2" fmla="*/ ss a1 200000" /><gd name="x1" fmla="+- hc 0 dx1" /><gd name="x2" fmla="+- hc 0 dx2" /><gd name="x3" fmla="+- hc dx2 0" /><gd name="x4" fmla="+- hc dx1 0" /><gd name="y1" fmla="*/ ss a3 100000" /><gd name="y4" fmla="+- b 0 y1" /><gd name="dy2" fmla="*/ h a4 200000" /><gd name="y2" fmla="+- vc 0 dy2" /><gd name="y3" fmla="+- vc dy2 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="maxAdj1"><pos x="x2" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="maxAdj2"><pos x="x1" y="t" /></ahXY><ahXY gdRefY="adj3" minY="0" maxY="maxAdj3"><pos x="r" y="y1" /></ahXY><ahXY gdRefY="adj4" minY="0" maxY="maxAdj4"><pos x="l" y="y2" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn></cxnLst><rect l="l" t="y2" r="r" b="y3" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="y2" /></moveTo><lnTo><pt x="x2" y="y2" /></lnTo><lnTo><pt x="x2" y="y1" /></lnTo><lnTo><pt x="x1" y="y1" /></lnTo><lnTo><pt x="hc" y="t" /></lnTo><lnTo><pt x="x4" y="y1" /></lnTo><lnTo><pt x="x3" y="y1" /></lnTo><lnTo><pt x="x3" y="y2" /></lnTo><lnTo><pt x="r" y="y2" /></lnTo><lnTo><pt x="r" y="y3" /></lnTo><lnTo><pt x="x3" y="y3" /></lnTo><lnTo><pt x="x3" y="y4" /></lnTo><lnTo><pt x="x4" y="y4" /></lnTo><lnTo><pt x="hc" y="b" /></lnTo><lnTo><pt x="x1" y="y4" /></lnTo><lnTo><pt x="x2" y="y4" /></lnTo><lnTo><pt x="x2" y="y3" /></lnTo><lnTo><pt x="l" y="y3" /></lnTo><close /></path></pathLst>';
var ps = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 25000" /><gd name="adj2" fmla="val 25000" /><gd name="adj3" fmla="val 25000" /><gd name="adj4" fmla="val 43750" /><gd name="adj5" fmla="val 75000" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a2" fmla="pin 0 adj2 25000" /><gd name="maxAdj1" fmla="*/ a2 2 1" /><gd name="a1" fmla="pin 0 adj1 maxAdj1" /><gd name="q2" fmla="*/ a1 ss h" /><gd name="q3" fmla="+- 100000 0 q2" /><gd name="maxAdj3" fmla="*/ q3 h ss" /><gd name="a3" fmla="pin 0 adj3 maxAdj3" /><gd name="q1" fmla="+- a3 a1 0" /><gd name="minAdj5" fmla="*/ q1 ss h" /><gd name="a5" fmla="pin minAdj5 adj5 100000" /><gd name="th" fmla="*/ ss a1 100000" /><gd name="aw2" fmla="*/ ss a2 100000" /><gd name="th2" fmla="*/ th 1 2" /><gd name="dh2" fmla="+- aw2 0 th2" /><gd name="y5" fmla="*/ h a5 100000" /><gd name="ah" fmla="*/ ss a3 100000" /><gd name="y4" fmla="+- y5 0 ah" /><gd name="x9" fmla="+- r 0 dh2" /><gd name="bw" fmla="*/ x9 1 2" /><gd name="bs" fmla="min bw y4" /><gd name="maxAdj4" fmla="*/ bs 100000 ss" /><gd name="a4" fmla="pin 0 adj4 maxAdj4" /><gd name="bd" fmla="*/ ss a4 100000" /><gd name="bd3" fmla="+- bd 0 th" /><gd name="bd2" fmla="max bd3 0" /><gd name="x3" fmla="+- th bd2 0" /><gd name="x8" fmla="+- r 0 aw2" /><gd name="x6" fmla="+- x8 0 aw2" /><gd name="x7" fmla="+- x6 dh2 0" /><gd name="x4" fmla="+- x9 0 bd" /><gd name="x5" fmla="+- x7 0 bd2" /><gd name="cx" fmla="+/ th x7 2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="0" maxX="maxAdj1"><pos x="th" y="b" /></ahXY><ahXY gdRefX="adj2" minX="0" maxX="25000"><pos x="x6" y="b" /></ahXY><ahXY gdRefY="adj3" minY="0" maxY="maxAdj3"><pos x="x6" y="y4" /></ahXY><ahXY gdRefX="adj4" minX="0" maxX="maxAdj4"><pos x="bd" y="t" /></ahXY><ahXY gdRefY="adj5" minY="minAdj5" maxY="100000"><pos x="r" y="y5" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd4"><pos x="x6" y="y4" /></cxn><cxn ang="cd4"><pos x="x8" y="y5" /></cxn><cxn ang="0"><pos x="r" y="y4" /></cxn><cxn ang="3cd4"><pos x="cx" y="t" /></cxn><cxn ang="cd4"><pos x="th2" y="b" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="b" /></moveTo><lnTo><pt x="l" y="bd" /></lnTo><arcTo wR="bd" hR="bd" stAng="cd2" swAng="cd4" /><lnTo><pt x="x4" y="t" /></lnTo><arcTo wR="bd" hR="bd" stAng="3cd4" swAng="cd4" /><lnTo><pt x="x9" y="y4" /></lnTo><lnTo><pt x="r" y="y4" /></lnTo><lnTo><pt x="x8" y="y5" /></lnTo><lnTo><pt x="x6" y="y4" /></lnTo><lnTo><pt x="x7" y="y4" /></lnTo><lnTo><pt x="x7" y="x3" /></lnTo><arcTo wR="bd2" hR="bd2" stAng="0" swAng="-5400000" /><lnTo><pt x="x3" y="th" /></lnTo><arcTo wR="bd2" hR="bd2" stAng="3cd4" swAng="-5400000" /><lnTo><pt x="th" y="b" /></lnTo><close /></path></pathLst>';
var is = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj" fmla="val 12500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a" fmla="pin 0 adj 25000" /><gd name="ch" fmla="*/ ss a 100000" /><gd name="ch2" fmla="*/ ch 1 2" /><gd name="ch4" fmla="*/ ch 1 4" /><gd name="x3" fmla="+- ch ch2 0" /><gd name="x4" fmla="+- ch ch 0" /><gd name="x6" fmla="+- r 0 ch" /><gd name="x7" fmla="+- r 0 ch2" /><gd name="x5" fmla="+- x6 0 ch2" /><gd name="y3" fmla="+- b 0 ch" /><gd name="y4" fmla="+- b 0 ch2" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj" minY="0" maxY="25000"><pos x="l" y="ch" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="0"><pos x="ch" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd2"><pos x="x6" y="vc" /></cxn></cxnLst><rect l="ch" t="ch" r="x6" b="y4" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path stroke="false" extrusionOk="false"><moveTo><pt x="ch2" y="b" /></moveTo><arcTo wR="ch2" hR="ch2" stAng="cd4" swAng="-5400000" /><lnTo><pt x="ch2" y="y4" /></lnTo><arcTo wR="ch4" hR="ch4" stAng="cd4" swAng="-10800000" /><lnTo><pt x="ch" y="y3" /></lnTo><lnTo><pt x="ch" y="ch2" /></lnTo><arcTo wR="ch2" hR="ch2" stAng="cd2" swAng="cd4" /><lnTo><pt x="x7" y="t" /></lnTo><arcTo wR="ch2" hR="ch2" stAng="3cd4" swAng="cd2" /><lnTo><pt x="x6" y="ch" /></lnTo><lnTo><pt x="x6" y="y4" /></lnTo><arcTo wR="ch2" hR="ch2" stAng="0" swAng="cd4" /><close /><moveTo><pt x="x4" y="ch2" /></moveTo><arcTo wR="ch2" hR="ch2" stAng="0" swAng="cd4" /><arcTo wR="ch4" hR="ch4" stAng="cd4" swAng="cd2" /><close /></path><path fill="darkenLess" stroke="false" extrusionOk="false"><moveTo><pt x="x4" y="ch2" /></moveTo><arcTo wR="ch2" hR="ch2" stAng="0" swAng="cd4" /><arcTo wR="ch4" hR="ch4" stAng="cd4" swAng="cd2" /><close /><moveTo><pt x="ch" y="y4" /></moveTo><arcTo wR="ch2" hR="ch2" stAng="0" swAng="3cd4" /><arcTo wR="ch4" hR="ch4" stAng="3cd4" swAng="cd2" /><close /></path><path fill="none" extrusionOk="false"><moveTo><pt x="ch" y="y3" /></moveTo><lnTo><pt x="ch" y="ch2" /></lnTo><arcTo wR="ch2" hR="ch2" stAng="cd2" swAng="cd4" /><lnTo><pt x="x7" y="t" /></lnTo><arcTo wR="ch2" hR="ch2" stAng="3cd4" swAng="cd2" /><lnTo><pt x="x6" y="ch" /></lnTo><lnTo><pt x="x6" y="y4" /></lnTo><arcTo wR="ch2" hR="ch2" stAng="0" swAng="cd4" /><lnTo><pt x="ch2" y="b" /></lnTo><arcTo wR="ch2" hR="ch2" stAng="cd4" swAng="cd2" /><close /><moveTo><pt x="x3" y="t" /></moveTo><arcTo wR="ch2" hR="ch2" stAng="3cd4" swAng="cd2" /><arcTo wR="ch4" hR="ch4" stAng="cd4" swAng="cd2" /><lnTo><pt x="x4" y="ch2" /></lnTo><moveTo><pt x="x6" y="ch" /></moveTo><lnTo><pt x="x3" y="ch" /></lnTo><moveTo><pt x="ch2" y="y3" /></moveTo><arcTo wR="ch4" hR="ch4" stAng="3cd4" swAng="cd2" /><lnTo><pt x="ch" y="y4" /></lnTo><moveTo><pt x="ch2" y="b" /></moveTo><arcTo wR="ch2" hR="ch2" stAng="cd4" swAng="-5400000" /><lnTo><pt x="ch" y="y3" /></lnTo></path></pathLst>';
var fs = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val 12500" /><gd name="adj2" fmla="val 0" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="a1" fmla="pin 0 adj1 20000" /><gd name="a2" fmla="pin -10000 adj2 10000" /><gd name="y1" fmla="*/ h a1 100000" /><gd name="dy2" fmla="*/ y1 10 3" /><gd name="y2" fmla="+- y1 0 dy2" /><gd name="y3" fmla="+- y1 dy2 0" /><gd name="y4" fmla="+- b 0 y1" /><gd name="y5" fmla="+- y4 0 dy2" /><gd name="y6" fmla="+- y4 dy2 0" /><gd name="dx1" fmla="*/ w a2 100000" /><gd name="of2" fmla="*/ w a2 50000" /><gd name="x1" fmla="abs dx1" /><gd name="dx2" fmla="?: of2 0 of2" /><gd name="x2" fmla="+- l 0 dx2" /><gd name="dx5" fmla="?: of2 of2 0" /><gd name="x5" fmla="+- r 0 dx5" /><gd name="dx3" fmla="+/ dx2 x5 3" /><gd name="x3" fmla="+- x2 dx3 0" /><gd name="x4" fmla="+/ x3 x5 2" /><gd name="x6" fmla="+- l dx5 0" /><gd name="x10" fmla="+- r dx2 0" /><gd name="x7" fmla="+- x6 dx3 0" /><gd name="x8" fmla="+/ x7 x10 2" /><gd name="x9" fmla="+- r 0 x1" /><gd name="xAdj" fmla="+- hc dx1 0" /><gd name="xAdj2" fmla="+- hc 0 dx1" /><gd name="il" fmla="max x2 x6" /><gd name="ir" fmla="min x5 x10" /><gd name="it" fmla="*/ h a1 50000" /><gd name="ib" fmla="+- b 0 it" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefY="adj1" minY="0" maxY="20000"><pos x="l" y="y1" /></ahXY><ahXY gdRefX="adj2" minX="-10000" maxX="10000"><pos x="xAdj" y="b" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="cd4"><pos x="xAdj2" y="y1" /></cxn><cxn ang="cd2"><pos x="x1" y="vc" /></cxn><cxn ang="3cd4"><pos x="xAdj" y="y4" /></cxn><cxn ang="0"><pos x="x9" y="vc" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="x2" y="y1" /></moveTo><cubicBezTo><pt x="x3" y="y2" /><pt x="x4" y="y3" /><pt x="x5" y="y1" /></cubicBezTo><lnTo><pt x="x10" y="y4" /></lnTo><cubicBezTo><pt x="x8" y="y6" /><pt x="x7" y="y5" /><pt x="x6" y="y4" /></cubicBezTo><close /></path></pathLst>';
var hs = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val -20833" /><gd name="adj2" fmla="val 62500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="dxPos" fmla="*/ w adj1 100000" /><gd name="dyPos" fmla="*/ h adj2 100000" /><gd name="xPos" fmla="+- hc dxPos 0" /><gd name="yPos" fmla="+- vc dyPos 0" /><gd name="sdx" fmla="*/ dxPos h 1" /><gd name="sdy" fmla="*/ dyPos w 1" /><gd name="pang" fmla="at2 sdx sdy" /><gd name="stAng" fmla="+- pang 660000 0" /><gd name="enAng" fmla="+- pang 0 660000" /><gd name="dx1" fmla="cos wd2 stAng" /><gd name="dy1" fmla="sin hd2 stAng" /><gd name="x1" fmla="+- hc dx1 0" /><gd name="y1" fmla="+- vc dy1 0" /><gd name="dx2" fmla="cos wd2 enAng" /><gd name="dy2" fmla="sin hd2 enAng" /><gd name="x2" fmla="+- hc dx2 0" /><gd name="y2" fmla="+- vc dy2 0" /><gd name="stAng1" fmla="at2 dx1 dy1" /><gd name="enAng1" fmla="at2 dx2 dy2" /><gd name="swAng1" fmla="+- enAng1 0 stAng1" /><gd name="swAng2" fmla="+- swAng1 21600000 0" /><gd name="swAng" fmla="?: swAng1 swAng1 swAng2" /><gd name="idx" fmla="cos wd2 2700000" /><gd name="idy" fmla="sin hd2 2700000" /><gd name="il" fmla="+- hc 0 idx" /><gd name="ir" fmla="+- hc idx 0" /><gd name="it" fmla="+- vc 0 idy" /><gd name="ib" fmla="+- vc idy 0" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="-2147483647" maxX="2147483647" gdRefY="adj2" minY="-2147483647" maxY="2147483647"><pos x="xPos" y="yPos" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="3cd4"><pos x="il" y="it" /></cxn><cxn ang="cd4"><pos x="il" y="ib" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="cd4"><pos x="ir" y="ib" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="3cd4"><pos x="ir" y="it" /></cxn><cxn ang="pang"><pos x="xPos" y="yPos" /></cxn></cxnLst><rect l="il" t="it" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="xPos" y="yPos" /></moveTo><lnTo><pt x="x1" y="y1" /></lnTo><arcTo wR="wd2" hR="hd2" stAng="stAng1" swAng="swAng" /><close /></path></pathLst>';
var ys = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val -20833" /><gd name="adj2" fmla="val 62500" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="dxPos" fmla="*/ w adj1 100000" /><gd name="dyPos" fmla="*/ h adj2 100000" /><gd name="xPos" fmla="+- hc dxPos 0" /><gd name="yPos" fmla="+- vc dyPos 0" /><gd name="dx" fmla="+- xPos 0 hc" /><gd name="dy" fmla="+- yPos 0 vc" /><gd name="dq" fmla="*/ dxPos h w" /><gd name="ady" fmla="abs dyPos" /><gd name="adq" fmla="abs dq" /><gd name="dz" fmla="+- ady 0 adq" /><gd name="xg1" fmla="?: dxPos 7 2" /><gd name="xg2" fmla="?: dxPos 10 5" /><gd name="x1" fmla="*/ w xg1 12" /><gd name="x2" fmla="*/ w xg2 12" /><gd name="yg1" fmla="?: dyPos 7 2" /><gd name="yg2" fmla="?: dyPos 10 5" /><gd name="y1" fmla="*/ h yg1 12" /><gd name="y2" fmla="*/ h yg2 12" /><gd name="t1" fmla="?: dxPos l xPos" /><gd name="xl" fmla="?: dz l t1" /><gd name="t2" fmla="?: dyPos x1 xPos" /><gd name="xt" fmla="?: dz t2 x1" /><gd name="t3" fmla="?: dxPos xPos r" /><gd name="xr" fmla="?: dz r t3" /><gd name="t4" fmla="?: dyPos xPos x1" /><gd name="xb" fmla="?: dz t4 x1" /><gd name="t5" fmla="?: dxPos y1 yPos" /><gd name="yl" fmla="?: dz y1 t5" /><gd name="t6" fmla="?: dyPos t yPos" /><gd name="yt" fmla="?: dz t6 t" /><gd name="t7" fmla="?: dxPos yPos y1" /><gd name="yr" fmla="?: dz y1 t7" /><gd name="t8" fmla="?: dyPos yPos b" /><gd name="yb" fmla="?: dz t8 b" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="-2147483647" maxX="2147483647" gdRefY="adj2" minY="-2147483647" maxY="2147483647"><pos x="xPos" y="yPos" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="xPos" y="yPos" /></cxn></cxnLst><rect l="l" t="t" r="r" b="b" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="t" /></moveTo><lnTo><pt x="x1" y="t" /></lnTo><lnTo><pt x="xt" y="yt" /></lnTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="r" y="t" /></lnTo><lnTo><pt x="r" y="y1" /></lnTo><lnTo><pt x="xr" y="yr" /></lnTo><lnTo><pt x="r" y="y2" /></lnTo><lnTo><pt x="r" y="b" /></lnTo><lnTo><pt x="x2" y="b" /></lnTo><lnTo><pt x="xb" y="yb" /></lnTo><lnTo><pt x="x1" y="b" /></lnTo><lnTo><pt x="l" y="b" /></lnTo><lnTo><pt x="l" y="y2" /></lnTo><lnTo><pt x="xl" y="yl" /></lnTo><lnTo><pt x="l" y="y1" /></lnTo><close /></path></pathLst>';
var Ts = '<avLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="adj1" fmla="val -20833" /><gd name="adj2" fmla="val 62500" /><gd name="adj3" fmla="val 16667" /></avLst><gdLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><gd name="dxPos" fmla="*/ w adj1 100000" /><gd name="dyPos" fmla="*/ h adj2 100000" /><gd name="xPos" fmla="+- hc dxPos 0" /><gd name="yPos" fmla="+- vc dyPos 0" /><gd name="dq" fmla="*/ dxPos h w" /><gd name="ady" fmla="abs dyPos" /><gd name="adq" fmla="abs dq" /><gd name="dz" fmla="+- ady 0 adq" /><gd name="xg1" fmla="?: dxPos 7 2" /><gd name="xg2" fmla="?: dxPos 10 5" /><gd name="x1" fmla="*/ w xg1 12" /><gd name="x2" fmla="*/ w xg2 12" /><gd name="yg1" fmla="?: dyPos 7 2" /><gd name="yg2" fmla="?: dyPos 10 5" /><gd name="y1" fmla="*/ h yg1 12" /><gd name="y2" fmla="*/ h yg2 12" /><gd name="t1" fmla="?: dxPos l xPos" /><gd name="xl" fmla="?: dz l t1" /><gd name="t2" fmla="?: dyPos x1 xPos" /><gd name="xt" fmla="?: dz t2 x1" /><gd name="t3" fmla="?: dxPos xPos r" /><gd name="xr" fmla="?: dz r t3" /><gd name="t4" fmla="?: dyPos xPos x1" /><gd name="xb" fmla="?: dz t4 x1" /><gd name="t5" fmla="?: dxPos y1 yPos" /><gd name="yl" fmla="?: dz y1 t5" /><gd name="t6" fmla="?: dyPos t yPos" /><gd name="yt" fmla="?: dz t6 t" /><gd name="t7" fmla="?: dxPos yPos y1" /><gd name="yr" fmla="?: dz y1 t7" /><gd name="t8" fmla="?: dyPos yPos b" /><gd name="yb" fmla="?: dz t8 b" /><gd name="u1" fmla="*/ ss adj3 100000" /><gd name="u2" fmla="+- r 0 u1" /><gd name="v2" fmla="+- b 0 u1" /><gd name="il" fmla="*/ u1 29289 100000" /><gd name="ir" fmla="+- r 0 il" /><gd name="ib" fmla="+- b 0 il" /></gdLst><ahLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><ahXY gdRefX="adj1" minX="-2147483647" maxX="2147483647" gdRefY="adj2" minY="-2147483647" maxY="2147483647"><pos x="xPos" y="yPos" /></ahXY></ahLst><cxnLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><cxn ang="3cd4"><pos x="hc" y="t" /></cxn><cxn ang="cd2"><pos x="l" y="vc" /></cxn><cxn ang="cd4"><pos x="hc" y="b" /></cxn><cxn ang="0"><pos x="r" y="vc" /></cxn><cxn ang="cd4"><pos x="xPos" y="yPos" /></cxn></cxnLst><rect l="il" t="il" r="ir" b="ib" xmlns="http://schemas.openxmlformats.org/drawingml/2006/main" /><pathLst xmlns="http://schemas.openxmlformats.org/drawingml/2006/main"><path><moveTo><pt x="l" y="u1" /></moveTo><arcTo wR="u1" hR="u1" stAng="cd2" swAng="cd4" /><lnTo><pt x="x1" y="t" /></lnTo><lnTo><pt x="xt" y="yt" /></lnTo><lnTo><pt x="x2" y="t" /></lnTo><lnTo><pt x="u2" y="t" /></lnTo><arcTo wR="u1" hR="u1" stAng="3cd4" swAng="cd4" /><lnTo><pt x="r" y="y1" /></lnTo><lnTo><pt x="xr" y="yr" /></lnTo><lnTo><pt x="r" y="y2" /></lnTo><lnTo><pt x="r" y="v2" /></lnTo><arcTo wR="u1" hR="u1" stAng="0" swAng="cd4" /><lnTo><pt x="x2" y="b" /></lnTo><lnTo><pt x="xb" y="yb" /></lnTo><lnTo><pt x="x1" y="b" /></lnTo><lnTo><pt x="u1" y="b" /></lnTo><arcTo wR="u1" hR="u1" stAng="cd4" swAng="cd4" /><lnTo><pt x="l" y="y2" /></lnTo><lnTo><pt x="xl" y="yl" /></lnTo><lnTo><pt x="l" y="y1" /></lnTo><close /></path></pathLst>';
var ws = {
  accentBorderCallout1: em,
  accentBorderCallout2: dm,
  accentBorderCallout3: xm,
  accentCallout1: gm,
  accentCallout2: cm,
  accentCallout3: rm,
  actionButtonBackPrevious: pm,
  actionButtonBeginning: im,
  actionButtonBlank: fm,
  actionButtonDocument: hm,
  actionButtonEnd: ym,
  actionButtonForwardNext: Tm,
  actionButtonHelp: wm,
  actionButtonHome: vm,
  actionButtonInformation: Lm,
  actionButtonMovie: um,
  actionButtonReturn: Am,
  actionButtonSound: bm,
  arc: jm,
  bentArrow: $m,
  bentConnector2: Rm,
  bentConnector3: Ym,
  bentConnector4: Xm,
  bentConnector5: Cm,
  bentUpArrow: Fm,
  bevel: Bm,
  blockArc: km,
  borderCallout1: qm,
  borderCallout2: Mm,
  borderCallout3: Pm,
  bracePair: Sm,
  bracketPair: Om,
  callout1: Im,
  callout2: Dm,
  callout3: Em,
  can: zm,
  chartPlus: Gm,
  chartStar: Hm,
  chartX: Nm,
  chevron: Zm,
  chord: _m,
  circularArrow: Vm,
  cloud: Wm,
  cloudCallout: Qm,
  corner: Um,
  cornerTabs: Km,
  cube: Jm,
  curvedConnector2: at,
  curvedConnector3: nt,
  curvedConnector4: mt,
  curvedConnector5: tt,
  curvedDownArrow: ot,
  curvedLeftArrow: lt,
  curvedRightArrow: st,
  curvedUpArrow: et,
  decagon: dt,
  diagStripe: xt,
  diamond: gt,
  dodecagon: ct,
  donut: rt,
  doubleWave: pt,
  downArrow: it,
  downArrowCallout: ft,
  ellipse: ht,
  ellipseRibbon: yt,
  ellipseRibbon2: Tt,
  flowChartAlternateProcess: wt,
  flowChartCollate: vt,
  flowChartConnector: Lt,
  flowChartDecision: ut,
  flowChartDelay: At,
  flowChartDisplay: bt,
  flowChartDocument: jt,
  flowChartExtract: $t,
  flowChartInputOutput: Rt,
  flowChartInternalStorage: Yt,
  flowChartMagneticDisk: Xt,
  flowChartMagneticDrum: Ct,
  flowChartMagneticTape: Ft,
  flowChartManualInput: Bt,
  flowChartManualOperation: kt,
  flowChartMerge: qt,
  flowChartMultidocument: Mt,
  flowChartOfflineStorage: Pt,
  flowChartOffpageConnector: St,
  flowChartOnlineStorage: Ot,
  flowChartOr: It,
  flowChartPredefinedProcess: Dt,
  flowChartPreparation: Et,
  flowChartProcess: zt,
  flowChartPunchedCard: Gt,
  flowChartPunchedTape: Ht,
  flowChartSort: Nt,
  flowChartSummingJunction: Zt,
  flowChartTerminator: _t,
  foldedCorner: Vt,
  frame: Wt,
  funnel: Qt,
  gear6: Ut,
  gear9: Kt,
  halfFrame: Jt,
  heart: ao,
  heptagon: no,
  hexagon: mo,
  homePlate: to,
  horizontalScroll: oo,
  irregularSeal1: lo,
  irregularSeal2: so,
  leftArrow: eo,
  leftArrowCallout: xo,
  leftBrace: go,
  leftBracket: co,
  leftCircularArrow: ro,
  leftRightArrow: po,
  leftRightArrowCallout: io,
  leftRightCircularArrow: fo,
  leftRightRibbon: ho,
  leftRightUpArrow: yo,
  leftUpArrow: To,
  lightningBolt: wo,
  line: vo,
  lineInv: Lo,
  mathDivide: uo,
  mathEqual: Ao,
  mathMinus: bo,
  mathMultiply: jo,
  mathNotEqual: $o,
  mathPlus: Ro,
  moon: Yo,
  noSmoking: Xo,
  nonIsoscelesTrapezoid: Co,
  notchedRightArrow: Fo,
  octagon: Bo,
  parallelogram: ko,
  pentagon: qo,
  pie: Mo,
  pieWedge: Po,
  plaque: So,
  plaqueTabs: Oo,
  plus: Io,
  quadArrow: Do,
  quadArrowCallout: Eo,
  rect: zo,
  ribbon: Go,
  ribbon2: Ho,
  rightArrow: No,
  rightArrowCallout: Zo,
  rightBrace: _o,
  rightBracket: Vo,
  round1Rect: Wo,
  round2DiagRect: Qo,
  round2SameRect: Uo,
  roundRect: Ko,
  rtTriangle: Jo,
  smileyFace: al,
  snip1Rect: nl,
  snip2DiagRect: ml,
  snip2SameRect: tl,
  snipRoundRect: ol,
  squareTabs: ll,
  star10: sl,
  star12: el,
  star16: dl,
  star24: xl,
  star32: gl,
  star4: cl,
  star5: rl,
  star6: pl,
  star7: il,
  star8: fl,
  straightConnector1: hl,
  stripedRightArrow: yl,
  sun: Tl,
  swooshArrow: wl,
  teardrop: vl,
  textArchDown: Ll,
  textArchDownPour: ul,
  textArchUp: Al,
  textArchUpPour: bl,
  textButton: jl,
  textButtonPour: $l,
  textCanDown: Rl,
  textCanUp: Yl,
  textCascadeDown: Xl,
  textCascadeUp: Cl,
  textChevron: Fl,
  textChevronInverted: Bl,
  textCircle: kl,
  textCirclePour: ql,
  textCurveDown: Ml,
  textCurveUp: Pl,
  textDeflate: Sl,
  textDeflateBottom: Ol,
  textDeflateInflate: Il,
  textDeflateInflateDeflate: Dl,
  textDeflateTop: El,
  textDoubleWave1: zl,
  textFadeDown: Gl,
  textFadeLeft: Hl,
  textFadeRight: Nl,
  textFadeUp: Zl,
  textInflate: _l,
  textInflateBottom: Vl,
  textInflateTop: Wl,
  textPlain: Ql,
  textRingInside: Ul,
  textRingOutside: Kl,
  textSlantDown: Jl,
  textSlantUp: as,
  textStop: ns,
  textTriangle: ms,
  textTriangleInverted: ts,
  textWave1: os,
  textWave2: ls,
  textWave4: ss,
  trapezoid: es,
  triangle: ds,
  upArrow: xs,
  upArrowCallout: gs,
  upDownArrow: cs,
  upDownArrowCallout: rs,
  uturnArrow: ps,
  verticalScroll: is,
  wave: fs,
  wedgeEllipseCallout: hs,
  wedgeRectCallout: ys,
  wedgeRoundRectCallout: Ts
};
var zn = ws;
var vs = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  removeNSPrefix: true,
  parseTagValue: false,
  processEntities: false
});
function Xa(a) {
  return a[":@"] ?? {};
}
function La(a) {
  for (const n of Object.keys(a)) {
    if (n === ":@") continue;
    const m = a[n];
    if (Array.isArray(m)) return m;
  }
  return [];
}
function mn(a) {
  for (const n of Object.keys(a))
    if (n !== ":@") return n;
  return "";
}
function Ra(a, n) {
  return a.find((m) => mn(m) === n);
}
function Ya(a, n) {
  return a.filter((m) => mn(m) === n);
}
function ra(a, n, m, t) {
  const o = Xa(a), l = n.getValue(o["@_x"] ?? "0") * m, s2 = n.getValue(o["@_y"] ?? "0") * t;
  return [l, s2];
}
function Ls(a, n, m, t, o, l) {
  const s2 = Math.PI / 108e5, e = o * s2, d2 = l * s2;
  if (Math.abs(d2) < 1e-10) return { d: "", endX: a, endY: n };
  const x = e + d2, g = a - m * Math.cos(e), c = n - t * Math.sin(e), r = g + m * Math.cos(x), p = c + t * Math.sin(x), i = Math.abs(d2) > Math.PI ? 1 : 0, f = d2 > 0 ? 1 : 0;
  return {
    d: `A${m},${t} 0 ${i},${f} ${r},${p}`,
    endX: r,
    endY: p
  };
}
function U(a) {
  return Math.round(a * 100) / 100;
}
function us(a, n, m, t) {
  const o = Xa(a), l = o["@_w"] != null ? Number(o["@_w"]) : t.width, s2 = o["@_h"] != null ? Number(o["@_h"]) : t.height, e = l > 0 ? n / l : 1, d2 = s2 > 0 ? m / s2 : 1, x = [];
  let g = 0, c = 0;
  for (const r of La(a)) {
    const p = mn(r), i = La(r);
    switch (p) {
      case "moveTo": {
        const f = Ra(i, "pt");
        if (!f) break;
        const [h, L] = ra(f, t, e, d2);
        x.push(`M${U(h)},${U(L)}`), g = h, c = L;
        break;
      }
      case "lnTo": {
        const f = Ra(i, "pt");
        if (!f) break;
        const [h, L] = ra(f, t, e, d2);
        x.push(`L${U(h)},${U(L)}`), g = h, c = L;
        break;
      }
      case "cubicBezTo": {
        const f = Ya(i, "pt");
        if (f.length < 3) break;
        const [h, L] = ra(f[0], t, e, d2), [u, A] = ra(f[1], t, e, d2), [T, j] = ra(f[2], t, e, d2);
        x.push(`C${U(h)},${U(L)} ${U(u)},${U(A)} ${U(T)},${U(j)}`), g = T, c = j;
        break;
      }
      case "quadBezTo": {
        const f = Ya(i, "pt");
        if (f.length < 2) break;
        const [h, L] = ra(f[0], t, e, d2), [u, A] = ra(f[1], t, e, d2);
        x.push(`Q${U(h)},${U(L)} ${U(u)},${U(A)}`), g = u, c = A;
        break;
      }
      case "arcTo": {
        const f = Xa(r), h = t.getValue(f["@_wR"] ?? "0") * e, L = t.getValue(f["@_hR"] ?? "0") * d2, u = t.getValue(f["@_stAng"] ?? "0"), A = t.getValue(f["@_swAng"] ?? "0"), T = Ls(g, c, h, L, u, A);
        T.d && x.push(T.d), g = T.endX, c = T.endY;
        break;
      }
      case "close":
        x.push("Z");
        break;
    }
  }
  return x.join(" ");
}
function As(a, n, m, t) {
  const o = zn[a];
  if (!o) return null;
  const l = `<shape>${o}</shape>`;
  let s2;
  try {
    s2 = vs.parse(l);
  } catch {
    return null;
  }
  const e = s2[0];
  if (!e) return null;
  const d2 = La(e), x = new sm(), g = Ra(d2, "avLst");
  if (g)
    for (const f of Ya(La(g), "gd")) {
      const h = Xa(f), L = h["@_name"], u = h["@_fmla"];
      L && u && x.addAdjustment(L, u);
    }
  const c = Ra(d2, "gdLst");
  if (c)
    for (const f of Ya(La(c), "gd")) {
      const h = Xa(f), L = h["@_name"], u = h["@_fmla"];
      L && u && x.addGuide(L, u);
    }
  if (t)
    for (const [f, h] of Object.entries(t))
      x.setAdjustValue(f, h);
  x.setWidthHeight(n, m), x.reCalculateGuides();
  const r = Ra(d2, "pathLst");
  if (!r) return null;
  const p = Ya(La(r), "path");
  if (p.length === 0) return null;
  const i = [];
  for (const f of p) {
    const h = us(f, n, m, x);
    h && i.push(h);
  }
  return i.join(" ");
}
function bs(a) {
  return Object.prototype.hasOwnProperty.call(zn, a);
}
function js(a, n, m) {
  return Math.max(n, Math.min(m, a));
}
function v(a, n, m) {
  return ((a == null ? void 0 : a[n]) ?? m) / 1e5;
}
function ga(a, n) {
  return (m, t, o) => {
    const l = v(o, "adj", n), s2 = m / 2, e = t / 2, d2 = [];
    for (let x = 0; x < a; x++) {
      const g = -Math.PI / 2 + 2 * Math.PI * x / a;
      d2.push([s2 + m / 2 * Math.cos(g), e + t / 2 * Math.sin(g)]);
      const c = g + Math.PI / a;
      d2.push([s2 + m / 2 * l * Math.cos(c), e + t / 2 * l * Math.sin(c)]);
    }
    return `M${d2[0][0]},${d2[0][1]}` + d2.slice(1).map(([x, g]) => ` L${x},${g}`).join("") + " Z";
  };
}
function tn(a) {
  return (n, m) => {
    const t = n / 2, o = m / 2, l = [];
    for (let s2 = 0; s2 < a; s2++) {
      const e = -Math.PI / 2 + 2 * Math.PI * s2 / a;
      l.push([t + n / 2 * Math.cos(e), o + m / 2 * Math.sin(e)]);
    }
    return `M${l[0][0]},${l[0][1]}` + l.slice(1).map(([s2, e]) => ` L${s2},${e}`).join("") + " Z";
  };
}
var Za = (a, n) => `M0,0 L${a},0 L${a},${n} L0,${n} Z`;
var $s = (a, n, m) => {
  const t = v(m, "adj", 16667), o = js(Math.min(a, n) * t, 0, Math.min(a, n) / 2);
  return [
    `M${o},0`,
    `L${a - o},0`,
    `Q${a},0 ${a},${o}`,
    `L${a},${n - o}`,
    `Q${a},${n} ${a - o},${n}`,
    `L${o},${n}`,
    `Q0,${n} 0,${n - o}`,
    `L0,${o}`,
    `Q0,0 ${o},0`,
    "Z"
  ].join(" ");
};
var Rs = (a, n) => {
  const m = a / 2, t = n / 2;
  return [
    `M${m},0`,
    `A${m},${t} 0 1,1 ${m},${n}`,
    `A${m},${t} 0 1,1 ${m},0`,
    "Z"
  ].join(" ");
};
var Ys = (a, n, m) => {
  const t = v(m, "adj", 5e4);
  return `M${a * t},0 L${a},${n} L0,${n} Z`;
};
var Xs = (a, n) => `M0,0 L${a},${n} L0,${n} Z`;
var Cs = (a, n) => {
  const m = a / 2, t = n / 2;
  return `M${m},0 L${a},${t} L${m},${n} L0,${t} Z`;
};
var Fs = (a, n, m) => {
  const t = v(m, "adj", 25e3), o = a * t;
  return `M${o},0 L${a},0 L${a - o},${n} L0,${n} Z`;
};
var Bs = (a, n, m) => {
  const t = v(m, "adj", 25e3), o = a * t;
  return `M${o},0 L${a - o},0 L${a},${n} L0,${n} Z`;
};
var ks = (a, n) => {
  const m = a / 2, t = [];
  for (let o = 0; o < 5; o++) {
    const l = -Math.PI / 2 + 2 * Math.PI * o / 5;
    t.push([m + a / 2 * Math.cos(l), n / 2 + n / 2 * Math.sin(l)]);
  }
  return `M${t[0][0]},${t[0][1]}` + t.slice(1).map(([o, l]) => ` L${o},${l}`).join("") + " Z";
};
var qs = (a, n, m) => {
  const t = v(m, "adj", 25e3), o = a * t, l = n / 2;
  return [
    `M${o},0`,
    `L${a - o},0`,
    `L${a},${l}`,
    `L${a - o},${n}`,
    `L${o},${n}`,
    `L0,${l}`,
    "Z"
  ].join(" ");
};
var Ms = (a, n, m) => {
  const t = v(m, "adj", 29289), o = a * t, l = n * t;
  return [
    `M${o},0`,
    `L${a - o},0`,
    `L${a},${l}`,
    `L${a},${n - l}`,
    `L${a - o},${n}`,
    `L${o},${n}`,
    `L0,${n - l}`,
    `L0,${l}`,
    "Z"
  ].join(" ");
};
var Ps = tn(7);
var Ss = tn(10);
var Os = tn(12);
var Is = (a, n, m) => {
  const t = v(m, "adj1", 5e4), o = v(m, "adj2", 5e4), l = n * t / 2, s2 = a * o, e = n / 2, d2 = e - (n - 2 * l) / 2, x = e + (n - 2 * l) / 2, g = a - s2;
  return [
    `M0,${d2}`,
    `L${g},${d2}`,
    `L${g},0`,
    `L${a},${e}`,
    `L${g},${n}`,
    `L${g},${x}`,
    `L0,${x}`,
    "Z"
  ].join(" ");
};
var Ds = (a, n, m) => {
  const t = v(m, "adj1", 5e4), o = v(m, "adj2", 5e4), l = n * t / 2, s2 = a * o, e = n / 2, d2 = e - (n - 2 * l) / 2, x = e + (n - 2 * l) / 2, g = s2;
  return [
    `M${a},${d2}`,
    `L${g},${d2}`,
    `L${g},0`,
    `L0,${e}`,
    `L${g},${n}`,
    `L${g},${x}`,
    `L${a},${x}`,
    "Z"
  ].join(" ");
};
var Es = (a, n, m) => {
  const t = v(m, "adj1", 5e4), o = v(m, "adj2", 5e4), l = a * t / 2, s2 = n * o, e = a / 2, d2 = e - (a - 2 * l) / 2, x = e + (a - 2 * l) / 2, g = s2;
  return [
    `M${d2},${n}`,
    `L${d2},${g}`,
    `L0,${g}`,
    `L${e},0`,
    `L${a},${g}`,
    `L${x},${g}`,
    `L${x},${n}`,
    "Z"
  ].join(" ");
};
var zs = (a, n, m) => {
  const t = v(m, "adj1", 5e4), o = v(m, "adj2", 5e4), l = a * t / 2, s2 = n * o, e = a / 2, d2 = e - (a - 2 * l) / 2, x = e + (a - 2 * l) / 2, g = n - s2;
  return [
    `M${d2},0`,
    `L${d2},${g}`,
    `L0,${g}`,
    `L${e},${n}`,
    `L${a},${g}`,
    `L${x},${g}`,
    `L${x},0`,
    "Z"
  ].join(" ");
};
var Gs = (a, n, m) => {
  const t = v(m, "adj1", 5e4), o = v(m, "adj2", 25e3), l = n * t / 2, s2 = a * o, e = n / 2, d2 = e - (n - 2 * l) / 2, x = e + (n - 2 * l) / 2;
  return [
    `M0,${e}`,
    `L${s2},0`,
    `L${s2},${d2}`,
    `L${a - s2},${d2}`,
    `L${a - s2},0`,
    `L${a},${e}`,
    `L${a - s2},${n}`,
    `L${a - s2},${x}`,
    `L${s2},${x}`,
    `L${s2},${n}`,
    "Z"
  ].join(" ");
};
var Hs = (a, n, m) => {
  const t = v(m, "adj1", 5e4), o = v(m, "adj2", 25e3), l = a * t / 2, s2 = n * o, e = a / 2, d2 = e - (a - 2 * l) / 2, x = e + (a - 2 * l) / 2;
  return [
    `M${e},0`,
    `L${a},${s2}`,
    `L${x},${s2}`,
    `L${x},${n - s2}`,
    `L${a},${n - s2}`,
    `L${e},${n}`,
    `L0,${n - s2}`,
    `L${d2},${n - s2}`,
    `L${d2},${s2}`,
    `L0,${s2}`,
    "Z"
  ].join(" ");
};
var Ns = (a, n, m) => {
  const t = v(m, "adj1", 22500), o = v(m, "adj2", 22500), l = v(m, "adj3", 11250), s2 = a / 2, e = n / 2, d2 = a * l, x = n * l, g = a * t, c = n * t, r = a * o, p = n * o;
  return [
    `M${s2},0`,
    `L${s2 + g},${p}`,
    `L${s2 + d2},${p}`,
    `L${s2 + d2},${e - x}`,
    `L${a - r},${e - x}`,
    `L${a - r},${e - c}`,
    `L${a},${e}`,
    `L${a - r},${e + c}`,
    `L${a - r},${e + x}`,
    `L${s2 + d2},${e + x}`,
    `L${s2 + d2},${n - p}`,
    `L${s2 + g},${n - p}`,
    `L${s2},${n}`,
    `L${s2 - g},${n - p}`,
    `L${s2 - d2},${n - p}`,
    `L${s2 - d2},${e + x}`,
    `L${r},${e + x}`,
    `L${r},${e + c}`,
    `L0,${e}`,
    `L${r},${e - c}`,
    `L${r},${e - x}`,
    `L${s2 - d2},${e - x}`,
    `L${s2 - d2},${p}`,
    `L${s2 - g},${p}`,
    "Z"
  ].join(" ");
};
var Zs = (a, n, m) => {
  const t = v(m, "adj", 5e4), o = a * t;
  return [
    "M0,0",
    `L${a - o},0`,
    `L${a},${n / 2}`,
    `L${a - o},${n}`,
    `L0,${n}`,
    `L${o},${n / 2}`,
    "Z"
  ].join(" ");
};
var _s = (a, n, m) => {
  const t = v(m, "adj", 5e4), o = a * t;
  return [
    "M0,0",
    `L${a - o},0`,
    `L${a},${n / 2}`,
    `L${a - o},${n}`,
    `L0,${n}`,
    "Z"
  ].join(" ");
};
var Vs = (a, n, m) => {
  const t = v(m, "adj1", 5e4), o = v(m, "adj2", 5e4), l = n * t / 2, s2 = a * o, e = n / 2, d2 = e - (n - 2 * l) / 2, x = e + (n - 2 * l) / 2, g = a - s2;
  return [
    `M0,${d2}`,
    `L${g},${d2}`,
    `L${g},0`,
    `L${a},${e}`,
    `L${g},${n}`,
    `L${g},${x}`,
    `L0,${x}`,
    `L${a - s2 - g > 0 ? s2 * 0.3 : 0},${e}`,
    "Z"
  ].join(" ");
};
var Ws = (a, n, m) => {
  const t = v(m, "adj1", 5e4), o = v(m, "adj2", 5e4), l = n * t / 2, s2 = a * o, e = n / 2, d2 = e - (n - 2 * l) / 2, x = e + (n - 2 * l) / 2, g = a - s2, c = a * 0.05;
  return [
    `M${c * 2},${d2}`,
    `L${g},${d2}`,
    `L${g},0`,
    `L${a},${e}`,
    `L${g},${n}`,
    `L${g},${x}`,
    `L${c * 2},${x}`,
    "Z"
  ].join(" ");
};
var Qs = (a, n, m) => {
  const t = v(m, "adj", 37500), o = a / 2, l = n / 2, s2 = o * t, e = l * t;
  return [
    `M${o},0`,
    `L${o + s2},${l - e}`,
    `L${a},${l}`,
    `L${o + s2},${l + e}`,
    `L${o},${n}`,
    `L${o - s2},${l + e}`,
    `L0,${l}`,
    `L${o - s2},${l - e}`,
    "Z"
  ].join(" ");
};
var Us = (a, n, m) => {
  const t = v(m, "adj", 38200), o = a / 2, l = n / 2, s2 = [];
  for (let e = 0; e < 5; e++) {
    const d2 = -Math.PI / 2 + 2 * Math.PI * e / 5;
    s2.push([
      o + a / 2 * Math.cos(d2),
      l + n / 2 * Math.sin(d2)
    ]);
    const x = d2 + Math.PI / 5;
    s2.push([
      o + a / 2 * t * Math.cos(x),
      l + n / 2 * t * Math.sin(x)
    ]);
  }
  return `M${s2[0][0]},${s2[0][1]}` + s2.slice(1).map(([e, d2]) => ` L${e},${d2}`).join("") + " Z";
};
var Ks = ga(6, 28868);
var Js = ga(7, 34600);
var ae = ga(8, 37500);
var ne = ga(10, 38200);
var me = ga(12, 38200);
var te = ga(16, 38200);
var oe = ga(24, 38200);
var le = ga(32, 38200);
var se = (a, n, m) => {
  const t = v(m, "adj1", -20833) * a + a / 2, o = v(m, "adj2", 62500) * n + n / 2, l = a * 0.05;
  return [
    `M0,0 L${a},0 L${a},${n}`,
    `L${a / 2 + l},${n}`,
    `L${t},${o}`,
    `L${a / 2 - l},${n}`,
    `L0,${n} Z`
  ].join(" ");
};
var ee = (a, n, m) => {
  const t = Math.min(a, n) * 0.1, o = v(m, "adj1", -20833) * a + a / 2, l = v(m, "adj2", 62500) * n + n / 2, s2 = a * 0.05;
  return [
    `M${t},0`,
    `L${a - t},0 Q${a},0 ${a},${t}`,
    `L${a},${n - t} Q${a},${n} ${a - t},${n}`,
    `L${a / 2 + s2},${n}`,
    `L${o},${l}`,
    `L${a / 2 - s2},${n}`,
    `L${t},${n} Q0,${n} 0,${n - t}`,
    `L0,${t} Q0,0 ${t},0`,
    "Z"
  ].join(" ");
};
var de = (a, n, m) => {
  const t = v(m, "adj1", -20833) * a + a / 2, o = v(m, "adj2", 62500) * n + n / 2, l = a / 2, s2 = n / 2, e = Math.atan2(o - s2, t - l), d2 = 0.15, x = l + l * Math.cos(e - d2), g = s2 + s2 * Math.sin(e - d2), c = l + l * Math.cos(e + d2), r = s2 + s2 * Math.sin(e + d2);
  return [
    `M${c},${r}`,
    `A${l},${s2} 0 1 0 ${x},${g}`,
    `L${t},${o}`,
    "Z"
  ].join(" ");
};
var xe = (a, n, m) => {
  const t = v(m, "adj1", -20833) * a + a / 2, o = v(m, "adj2", 62500) * n + n / 2, l = Gn(a, n), s2 = (t + a / 2) / 2, e = (o + n * 0.8) / 2, d2 = Math.min(a, n) * 0.04, x = Math.min(a, n) * 0.025;
  return [
    l,
    `M${s2 + d2},${e}`,
    `A${d2},${d2} 0 1 0 ${s2 - d2},${e}`,
    `A${d2},${d2} 0 1 0 ${s2 + d2},${e} Z`,
    `M${t + x},${o}`,
    `A${x},${x} 0 1 0 ${t - x},${o}`,
    `A${x},${x} 0 1 0 ${t + x},${o} Z`
  ].join(" ");
};
var vn = (a, n, m) => {
  const t = v(m, "adj", 25e3), o = a * t, l = n * t;
  return [
    `M${o},0`,
    `L${a - o},0`,
    `L${a - o},${l}`,
    `L${a},${l}`,
    `L${a},${n - l}`,
    `L${a - o},${n - l}`,
    `L${a - o},${n}`,
    `L${o},${n}`,
    `L${o},${n - l}`,
    `L0,${n - l}`,
    `L0,${l}`,
    `L${o},${l}`,
    "Z"
  ].join(" ");
};
var ge = (a, n, m) => {
  const t = v(m, "adj", 25e3), o = a / 2, l = n / 2, s2 = o * (1 - t), e = l * (1 - t);
  return [
    // Outer ellipse
    `M${a},${l}`,
    `A${o},${l} 0 1 0 0,${l}`,
    `A${o},${l} 0 1 0 ${a},${l}`,
    "Z",
    // Inner ellipse (counter-clockwise)
    `M${o + s2},${l}`,
    `A${s2},${e} 0 1 1 ${o - s2},${l}`,
    `A${s2},${e} 0 1 1 ${o + s2},${l}`,
    "Z"
  ].join(" ");
};
var Gn = (a, n) => {
  const m = a / 2;
  return [
    `M${a * 0.15},${n * 0.6}`,
    `A${a * 0.2},${n * 0.2} 0 0 1 ${a * 0.2},${n * 0.3}`,
    `A${a * 0.2},${n * 0.2} 0 0 1 ${a * 0.4},${n * 0.15}`,
    `A${a * 0.2},${n * 0.2} 0 0 1 ${m},${n * 0.1}`,
    `A${a * 0.2},${n * 0.2} 0 0 1 ${a * 0.7},${n * 0.15}`,
    `A${a * 0.2},${n * 0.2} 0 0 1 ${a * 0.85},${n * 0.35}`,
    `A${a * 0.2},${n * 0.2} 0 0 1 ${a * 0.85},${n * 0.6}`,
    `A${a * 0.2},${n * 0.25} 0 0 1 ${a * 0.7},${n * 0.8}`,
    `Q${m},${n * 0.9} ${a * 0.3},${n * 0.8}`,
    `A${a * 0.2},${n * 0.2} 0 0 1 ${a * 0.15},${n * 0.6}`,
    "Z"
  ].join(" ");
};
var ce = (a, n) => {
  const m = a / 2;
  return [
    `M${m},${n * 0.3}`,
    `C${m},${n * 0.1} ${a * 0.25},0 ${a * 0.1},0`,
    `C0,0 0,${n * 0.25} 0,${n * 0.25}`,
    `C0,${n * 0.55} ${m},${n * 0.7} ${m},${n}`,
    `C${m},${n * 0.7} ${a},${n * 0.55} ${a},${n * 0.25}`,
    `C${a},${n * 0.25} ${a},0 ${a * 0.9},0`,
    `C${a * 0.75},0 ${m},${n * 0.1} ${m},${n * 0.3}`,
    "Z"
  ].join(" ");
};
var re = (a, n) => [
  `M${a * 0.4},0`,
  `L${a},${n * 0.35}`,
  `L${a * 0.55},${n * 0.35}`,
  `L${a * 0.8},${n * 0.65}`,
  `L${a * 0.5},${n * 0.65}`,
  `L${a * 0.7},${n}`,
  `L0,${n * 0.45}`,
  `L${a * 0.3},${n * 0.45}`,
  "Z"
].join(" ");
var pe = (a, n, m) => {
  const t = v(m, "adj", 16667), o = Math.min(a, n) * t;
  return [
    "M0,0",
    `L${a},0`,
    `L${a},${n - o}`,
    `L${a - o},${n}`,
    `L0,${n}`,
    "Z"
  ].join(" ");
};
var ie = (a, n, m) => {
  const t = v(m, "adj1", 12500), o = Math.min(a, n) * t;
  return [
    // Outer
    `M0,0 L${a},0 L${a},${n} L0,${n} Z`,
    // Inner (counter-clockwise)
    `M${o},${o} L${o},${n - o} L${a - o},${n - o} L${a - o},${o} Z`
  ].join(" ");
};
var fe = (a, n, m) => {
  const t = a / 2, o = n / 2, l = v(m, "adj3", 25e3), s2 = t * (1 - l), e = o * (1 - l);
  return [
    `M0,${o}`,
    `A${t},${o} 0 1 1 ${a},${o}`,
    `L${t + s2},${o}`,
    `A${s2},${e} 0 1 0 ${t - s2},${o}`,
    "Z"
  ].join(" ");
};
var he = (a, n) => {
  const m = a / 2, t = n / 2;
  return [
    `M${a},${t}`,
    `A${m},${t} 0 0 0 ${m},0`,
    `L${m},${t}`,
    "Z"
  ].join(" ");
};
var ye = (a, n, m) => {
  const t = v(m, "adj", 5e4), o = a / 2, l = n / 2, s2 = a * t / 2;
  return [
    `M${o},0`,
    `A${o},${l} 0 0 1 ${o},${n}`,
    `A${s2},${l} 0 0 0 ${o},0`,
    "Z"
  ].join(" ");
};
var Te = (a, n, m) => {
  const t = v(m, "adj", 25e3), o = a / 2, l = n / 2, s2 = 0.5, e = s2 * (1 - t), d2 = 8, x = Math.PI / (d2 * 3), g = Math.PI / (d2 * 1.5), c = [];
  for (let r = 0; r < d2; r++) {
    const p = -Math.PI / 2 + 2 * Math.PI * r / d2, i = `${o + a / 2 * e * Math.cos(p - g)},${l + n / 2 * e * Math.sin(p - g)}`, f = `${o + a / 2 * s2 * Math.cos(p - x)},${l + n / 2 * s2 * Math.sin(p - x)}`, h = `${o + a / 2 * s2 * Math.cos(p + x)},${l + n / 2 * s2 * Math.sin(p + x)}`, L = `${o + a / 2 * e * Math.cos(p + g)},${l + n / 2 * e * Math.sin(p + g)}`;
    c.push(i, f, h, L);
  }
  return `M${c[0]}` + c.slice(1).map((r) => ` L${r}`).join("") + " Z";
};
var we = (a, n, m) => {
  const t = v(m, "adj", 25e3), o = n * t, l = a / 2;
  return [
    `M0,${o}`,
    `A${l},${o} 0 0 1 ${a},${o}`,
    `L${a},${n - o}`,
    `A${l},${o} 0 0 1 0,${n - o}`,
    "Z",
    `M0,${o}`,
    `A${l},${o} 0 0 0 ${a},${o}`
  ].join(" ");
};
var ve = (a, n, m) => {
  const t = v(m, "adj", 25e3), o = Math.min(a, n) * t;
  return [
    `M0,${o} L${a - o},${o} L${a - o},${n} L0,${n} Z`,
    `M0,${o} L${o},0 L${a},0 L${a - o},${o} Z`,
    `M${a - o},${o} L${a},0 L${a},${n - o} L${a - o},${n} Z`
  ].join(" ");
};
var Le = (a, n) => {
  const m = a / 2, t = Math.min(a, n) / 2, o = n - t;
  return [
    `M${m},0`,
    `C${a * 0.8},${o * 0.5} ${a},${o * 0.7} ${a},${o}`,
    `A${t},${t} 0 1 1 0,${o}`,
    `C0,${o * 0.7} ${a * 0.2},${o * 0.5} ${m},0`,
    "Z"
  ].join(" ");
};
var ue = (a, n, m) => {
  const t = v(m, "adj1", 0) * 2 * Math.PI, o = v(m, "adj2", 75e3) * 2 * Math.PI, l = a / 2, s2 = n / 2, e = a / 2, d2 = n / 2, x = o - t > Math.PI ? 1 : 0;
  return [
    `M${l},${s2}`,
    `L${l + e * Math.cos(t)},${s2 + d2 * Math.sin(t)}`,
    `A${e},${d2} 0 ${x} 1 ${l + e * Math.cos(o)},${s2 + d2 * Math.sin(o)}`,
    "Z"
  ].join(" ");
};
var Ae = (a, n, m) => {
  const t = v(m, "adj1", 0) * 2 * Math.PI, o = v(m, "adj2", 75e3) * 2 * Math.PI, l = a / 2, s2 = n / 2, e = a / 2, d2 = n / 2, x = o - t > Math.PI ? 1 : 0;
  return [
    `M${l + e * Math.cos(t)},${s2 + d2 * Math.sin(t)}`,
    `A${e},${d2} 0 ${x} 1 ${l + e * Math.cos(o)},${s2 + d2 * Math.sin(o)}`,
    "Z"
  ].join(" ");
};
var be = (a, n, m) => {
  const t = v(m, "adj1", 5e4), o = v(m, "adj2", 5e4), l = a * o, s2 = n * t;
  return `M0,0 L${l},0 L${l},${n - s2} L${a},${n - s2} L${a},${n} L0,${n} Z`;
};
var je = (a, n, m) => {
  const t = v(m, "adj", 5e4);
  return `M0,${n * t} L${a * t},0 L0,0 Z`;
};
var $e = (a, n, m) => {
  const t = v(m, "adj", 16667), o = Math.min(a, n) * t;
  return [
    `M0,${o}`,
    `Q${o},${o} ${o},0`,
    `L${a - o},0`,
    `Q${a - o},${o} ${a},${o}`,
    `L${a},${n - o}`,
    `Q${a - o},${n - o} ${a - o},${n}`,
    `L${o},${n}`,
    `Q${o},${n - o} 0,${n - o}`,
    "Z"
  ].join(" ");
};
var Re = (a, n, m) => {
  const t = v(m, "adj", 12500), o = Math.min(a, n) * t;
  return [
    `M0,0 L${a},0 L${a},${n} L0,${n} Z`,
    `M${o},${o} L${o},${n - o} L${a - o},${n - o} L${a - o},${o} Z`
  ].join(" ");
};
var Ye = (a, n, m) => {
  const t = v(m, "adj", 18750), o = a / 2, l = n / 2, s2 = o * (1 - t), e = l * (1 - t);
  return [
    `M${a},${l}`,
    `A${o},${l} 0 1 0 0,${l}`,
    `A${o},${l} 0 1 0 ${a},${l}`,
    "Z",
    `M${o + s2},${l}`,
    `A${s2},${e} 0 1 1 ${o - s2},${l}`,
    `A${s2},${e} 0 1 1 ${o + s2},${l}`,
    "Z"
  ].join(" ");
};
var Xe = (a, n, m) => {
  const t = v(m, "adj1", 12500), o = n * t;
  return [
    `M0,${o}`,
    `C${a / 3},0 ${a * 2 / 3},${o * 2} ${a},${o}`,
    `L${a},${n - o}`,
    `C${a * 2 / 3},${n} ${a / 3},${n - o * 2} 0,${n - o}`,
    "Z"
  ].join(" ");
};
var Ce = (a, n, m) => {
  const t = v(m, "adj1", 6250), o = n * t;
  return [
    `M0,${o}`,
    `C${a / 6},0 ${a / 3},${o * 2} ${a / 2},${o}`,
    `C${a * 2 / 3},0 ${a * 5 / 6},${o * 2} ${a},${o}`,
    `L${a},${n - o}`,
    `C${a * 5 / 6},${n} ${a * 2 / 3},${n - o * 2} ${a / 2},${n - o}`,
    `C${a / 3},${n} ${a / 6},${n - o * 2} 0,${n - o}`,
    "Z"
  ].join(" ");
};
var Fe = (a, n) => [
  `M${a * 0.5},0`,
  `L${a * 0.4},${n * 0.2}`,
  `L${a * 0.15},${n * 0.1}`,
  `L${a * 0.25},${n * 0.35}`,
  `L0,${n * 0.35}`,
  `L${a * 0.2},${n * 0.5}`,
  `L${a * 0.05},${n * 0.7}`,
  `L${a * 0.3},${n * 0.65}`,
  `L${a * 0.35},${n * 0.9}`,
  `L${a * 0.5},${n * 0.7}`,
  `L${a * 0.65},${n}`,
  `L${a * 0.65},${n * 0.7}`,
  `L${a * 0.85},${n * 0.8}`,
  `L${a * 0.75},${n * 0.55}`,
  `L${a},${n * 0.5}`,
  `L${a * 0.8},${n * 0.35}`,
  `L${a * 0.95},${n * 0.15}`,
  `L${a * 0.65},${n * 0.3}`,
  "Z"
].join(" ");
var Be = (a, n) => [
  `M${a * 0.45},0`,
  `L${a * 0.4},${n * 0.15}`,
  `L${a * 0.15},${n * 0.05}`,
  `L${a * 0.2},${n * 0.3}`,
  `L0,${n * 0.4}`,
  `L${a * 0.15},${n * 0.5}`,
  `L${a * 0.05},${n * 0.75}`,
  `L${a * 0.25},${n * 0.7}`,
  `L${a * 0.3},${n * 0.95}`,
  `L${a * 0.45},${n * 0.75}`,
  `L${a * 0.55},${n}`,
  `L${a * 0.6},${n * 0.75}`,
  `L${a * 0.8},${n * 0.9}`,
  `L${a * 0.75},${n * 0.65}`,
  `L${a},${n * 0.55}`,
  `L${a * 0.8},${n * 0.4}`,
  `L${a * 0.95},${n * 0.2}`,
  `L${a * 0.7},${n * 0.25}`,
  `L${a * 0.65},${n * 0.05}`,
  `L${a * 0.55},${n * 0.2}`,
  "Z"
].join(" ");
var ke = (a, n, m) => {
  const t = v(m, "adj", 16667), o = Math.min(a, n) * t;
  return [
    "M0,0",
    `L${a - o},0 Q${a},0 ${a},${o}`,
    `L${a},${n}`,
    `L0,${n}`,
    "Z"
  ].join(" ");
};
var qe = (a, n, m) => {
  const t = v(m, "adj1", 16667), o = v(m, "adj2", 0), l = Math.min(a, n) * t, s2 = Math.min(a, n) * o;
  return [
    `M${l},0`,
    `L${a - l},0 Q${a},0 ${a},${l}`,
    `L${a},${n - s2} Q${a},${n} ${a - s2},${n}`,
    `L${s2},${n} Q0,${n} 0,${n - s2}`,
    `L0,${l} Q0,0 ${l},0`,
    "Z"
  ].join(" ");
};
var Me = (a, n, m) => {
  const t = v(m, "adj1", 16667), o = v(m, "adj2", 0), l = Math.min(a, n) * t, s2 = Math.min(a, n) * o;
  return [
    `M${s2},0`,
    `L${a - l},0 Q${a},0 ${a},${l}`,
    `L${a},${n - s2}`,
    `Q${a},${n} ${a - s2},${n}`,
    `L${l},${n} Q0,${n} 0,${n - l}`,
    `L0,${s2} Q0,0 ${s2},0`,
    "Z"
  ].join(" ");
};
var Pe = (a, n, m) => {
  const t = v(m, "adj", 16667), o = Math.min(a, n) * t;
  return [
    "M0,0",
    `L${a - o},0`,
    `L${a},${o}`,
    `L${a},${n}`,
    `L0,${n}`,
    "Z"
  ].join(" ");
};
var Se = (a, n, m) => {
  const t = v(m, "adj1", 16667), o = v(m, "adj2", 0), l = Math.min(a, n) * t, s2 = Math.min(a, n) * o;
  return [
    `M${l},0`,
    `L${a - l},0`,
    `L${a},${l}`,
    `L${a},${n - s2}`,
    `L${a - s2},${n}`,
    `L${s2},${n}`,
    `L0,${n - s2}`,
    `L0,${l}`,
    "Z"
  ].join(" ");
};
var Oe = (a, n, m) => {
  const t = v(m, "adj1", 16667), o = v(m, "adj2", 0), l = Math.min(a, n) * t, s2 = Math.min(a, n) * o;
  return [
    `M${s2},0`,
    `L${a - l},0`,
    `L${a},${l}`,
    `L${a},${n - s2}`,
    `L${a - s2},${n}`,
    `L${l},${n}`,
    `L0,${n - l}`,
    `L0,${s2}`,
    "Z"
  ].join(" ");
};
var Ie = (a, n, m) => {
  const t = v(m, "adj1", 16667), o = v(m, "adj2", 16667), l = Math.min(a, n) * t, s2 = Math.min(a, n) * o;
  return [
    `M${l},0`,
    `L${a - s2},0`,
    `L${a},${s2}`,
    `L${a},${n}`,
    `L0,${n}`,
    `L0,${l} Q0,0 ${l},0`,
    "Z"
  ].join(" ");
};
var De = (a, n) => `M0,0 L${a},0 L${a},${n} L0,${n} Z`;
var Ee = (a, n) => `M${a / 2},0 L${a},${n / 2} L${a / 2},${n} L0,${n / 2} Z`;
var ze = (a, n) => {
  const m = Math.min(a / 2, n / 2);
  return [
    `M${m},0`,
    `L${a - m},0`,
    `A${m},${n / 2} 0 0 1 ${a - m},${n}`,
    `L${m},${n}`,
    `A${m},${n / 2} 0 0 1 ${m},0`,
    "Z"
  ].join(" ");
};
var Ge = (a, n) => {
  const m = a * 0.1;
  return [
    `M0,0 L${a},0 L${a},${n} L0,${n} Z`,
    `M${m},0 L${m},${n}`,
    `M${a - m},0 L${a - m},${n}`
  ].join(" ");
};
var He = (a, n) => {
  const m = a * 0.2;
  return `M${m},0 L${a},0 L${a - m},${n} L0,${n} Z`;
};
var Ne = (a, n) => {
  const m = n * 0.1;
  return [
    `M0,0 L${a},0 L${a},${n - m}`,
    `C${a * 0.75},${n + m * 0.5} ${a * 0.25},${n - m * 2.5} 0,${n - m}`,
    "Z"
  ].join(" ");
};
var Ze = (a, n) => {
  const m = Math.min(a, n) * 0.08, t = n * 0.08;
  return [
    `M${m * 2},0 L${a},0 L${a},${n - t - m * 2}`,
    `L${a - m},${n - t - m * 2} L${a - m},${m} L${m * 2},${m} Z`,
    `M${m},${m} L${a - m},${m} L${a - m},${n - t - m}`,
    `L${a - m * 2},${n - t - m} L${a - m * 2},${m * 2} L${m},${m * 2} Z`,
    `M0,${m * 2} L${a - m * 2},${m * 2} L${a - m * 2},${n - t}`,
    `C${(a - m * 2) * 0.7},${n + t * 0.2} ${(a - m * 2) * 0.3},${n - t * 2} 0,${n - t}`,
    "Z"
  ].join(" ");
};
var _e = (a, n) => {
  const m = a * 0.2;
  return `M${m},0 L${a - m},0 L${a},${n / 2} L${a - m},${n} L${m},${n} L0,${n / 2} Z`;
};
var Ve = (a, n) => `M0,${n * 0.2} L${a},0 L${a},${n} L0,${n} Z`;
var We = (a, n) => {
  const m = a * 0.2;
  return `M0,0 L${a},0 L${a - m},${n} L${m},${n} Z`;
};
var Qe = (a, n) => {
  const m = a / 2, t = n / 2;
  return `M${m},0 A${m},${t} 0 1 1 ${m},${n} A${m},${t} 0 1 1 ${m},0 Z`;
};
var Ue = (a, n) => {
  const m = n * 0.3;
  return `M0,0 L${a},0 L${a},${n - m} L${a / 2},${n} L0,${n - m} Z`;
};
var Ke = (a, n) => {
  const m = Math.min(a, n) * 0.16667;
  return [
    `M${m},0`,
    `L${a - m},0 Q${a},0 ${a},${m}`,
    `L${a},${n - m} Q${a},${n} ${a - m},${n}`,
    `L${m},${n} Q0,${n} 0,${n - m}`,
    `L0,${m} Q0,0 ${m},0`,
    "Z"
  ].join(" ");
};
var Je = (a, n) => {
  const m = a / 2, t = n / 2;
  return [
    "M0,0",
    `L${m},0`,
    `A${m},${t} 0 0 1 ${m},${n}`,
    `L0,${n}`,
    "Z"
  ].join(" ");
};
var ad = (a, n) => `M${a / 2},0 L${a},${n} L0,${n} Z`;
var nd = (a, n) => `M0,0 L${a},0 L${a / 2},${n} Z`;
var md = (a, n) => {
  const m = a / 2, t = n / 2;
  return [
    `M${m},0 L${a},${t} L${m},${n} L0,${t} Z`,
    `M0,${t} L${a},${t}`
  ].join(" ");
};
var td = (a, n) => {
  const m = a / 2, t = n / 2, o = 0.707;
  return [
    `M${m},0 A${m},${t} 0 1 1 ${m},${n} A${m},${t} 0 1 1 ${m},0 Z`,
    `M${m - m * o},${t - t * o} L${m + m * o},${t + t * o}`,
    `M${m + m * o},${t - t * o} L${m - m * o},${t + t * o}`
  ].join(" ");
};
var od = (a, n) => {
  const m = a / 2, t = n / 2;
  return [
    `M${m},0 A${m},${t} 0 1 1 ${m},${n} A${m},${t} 0 1 1 ${m},0 Z`,
    `M${m},0 L${m},${n}`,
    `M0,${t} L${a},${t}`
  ].join(" ");
};
var ld = (a, n) => [
  `M0,0 L${a},0 L${a / 2},${n / 2} Z`,
  `M0,${n} L${a},${n} L${a / 2},${n / 2} Z`
].join(" ");
var sd = (a, n) => {
  const m = n * 0.15, t = a / 2;
  return [
    `M0,${m}`,
    `A${t},${m} 0 0 1 ${a},${m}`,
    `L${a},${n - m}`,
    `A${t},${m} 0 0 1 0,${n - m}`,
    "Z",
    `M0,${m}`,
    `A${t},${m} 0 0 0 ${a},${m}`
  ].join(" ");
};
var ed = (a, n) => {
  const m = a / 2, t = n / 2;
  return [
    `M${m},0`,
    `A${m},${t} 0 1 1 ${m},${n}`,
    `L${a},${n}`,
    `L${a},${t}`,
    `A${m},${t} 0 0 1 ${m},0`,
    "Z"
  ].join(" ");
};
var dd = (a, n) => {
  const m = Math.min(a, n) * 0.2;
  return `M${m},0 L${a},0 L${a},${n} L0,${n} L0,${m} Z`;
};
var xd = (a, n) => {
  const m = n * 0.1;
  return [
    `M0,${m}`,
    `C${a * 0.25},${-m * 0.5} ${a * 0.75},${m * 2.5} ${a},${m}`,
    `L${a},${n - m}`,
    `C${a * 0.75},${n + m * 0.5} ${a * 0.25},${n - m * 2.5} 0,${n - m}`,
    "Z"
  ].join(" ");
};
var gd = (a, n) => {
  const m = a * 0.15;
  return [
    `M${m},0`,
    `L${a},0`,
    `L${a},${n}`,
    `L${m},${n}`,
    `A${m},${n / 2} 0 0 1 ${m},0`,
    "Z"
  ].join(" ");
};
var cd = (a, n) => {
  const m = Math.min(a, n) * 0.15;
  return [
    `M0,0 L${a},0 L${a},${n} L0,${n} Z`,
    `M${m},0 L${m},${n}`,
    `M0,${m} L${a},${m}`
  ].join(" ");
};
var rd = (a, n) => {
  const m = a * 0.15;
  return [
    `M${m},0`,
    `A${m},${n / 2} 0 0 0 ${m},${n}`,
    `L${a - m},${n}`,
    `L${a},${n / 2}`,
    `L${a - m},0`,
    "Z"
  ].join(" ");
};
var pd = (a, n, m) => {
  const t = v(m, "adj", 8333), o = n * t;
  return [
    `M${a},0`,
    `L${a * 0.3},0`,
    `Q0,0 0,${o}`,
    `L0,${n - o}`,
    `Q0,${n} ${a * 0.3},${n}`,
    `L${a},${n}`
  ].join(" ");
};
var id = (a, n, m) => {
  const t = v(m, "adj", 8333), o = n * t;
  return [
    "M0,0",
    `L${a * 0.7},0`,
    `Q${a},0 ${a},${o}`,
    `L${a},${n - o}`,
    `Q${a},${n} ${a * 0.7},${n}`,
    `L0,${n}`
  ].join(" ");
};
var fd = (a, n, m) => {
  const t = v(m, "adj", 8333), o = Math.min(a / 2, n * t);
  return [
    `M${o},0 Q0,0 0,${o} L0,${n - o} Q0,${n} ${o},${n}`,
    `M${a - o},0 Q${a},0 ${a},${o} L${a},${n - o} Q${a},${n} ${a - o},${n}`
  ].join(" ");
};
var hd = (a, n, m) => {
  const t = v(m, "adj1", 8333), o = v(m, "adj2", 5e4), l = n * o, s2 = n * t;
  return [
    `M${a},0`,
    `Q${a * 0.5},0 ${a * 0.5},${s2}`,
    `L${a * 0.5},${l - s2}`,
    `Q${a * 0.5},${l} 0,${l}`,
    `Q${a * 0.5},${l} ${a * 0.5},${l + s2}`,
    `L${a * 0.5},${n - s2}`,
    `Q${a * 0.5},${n} ${a},${n}`
  ].join(" ");
};
var yd = (a, n, m) => {
  const t = v(m, "adj1", 8333), o = v(m, "adj2", 5e4), l = n * o, s2 = n * t;
  return [
    "M0,0",
    `Q${a * 0.5},0 ${a * 0.5},${s2}`,
    `L${a * 0.5},${l - s2}`,
    `Q${a * 0.5},${l} ${a},${l}`,
    `Q${a * 0.5},${l} ${a * 0.5},${l + s2}`,
    `L${a * 0.5},${n - s2}`,
    `Q${a * 0.5},${n} 0,${n}`
  ].join(" ");
};
var Td = (a, n, m) => {
  const t = v(m, "adj", 8333), o = n * t, l = n / 2, s2 = a * 0.1;
  return [
    `M${s2 * 2},0 Q${s2},0 ${s2},${o}`,
    `L${s2},${l - o}`,
    `Q${s2},${l} 0,${l}`,
    `Q${s2},${l} ${s2},${l + o}`,
    `L${s2},${n - o}`,
    `Q${s2},${n} ${s2 * 2},${n}`,
    `M${a - s2 * 2},0 Q${a - s2},0 ${a - s2},${o}`,
    `L${a - s2},${l - o}`,
    `Q${a - s2},${l} ${a},${l}`,
    `Q${a - s2},${l} ${a - s2},${l + o}`,
    `L${a - s2},${n - o}`,
    `Q${a - s2},${n} ${a - s2 * 2},${n}`
  ].join(" ");
};
var wd = (a, n, m) => {
  const t = v(m, "adj1", 25e3), o = n * t, l = (n - o) / 2;
  return `M0,${l} L${a},${l} L${a},${l + o} L0,${l + o} Z`;
};
var vd = (a, n, m) => {
  const t = v(m, "adj1", 23520), o = Math.min(a, n) * t / 2, l = a / 2, s2 = n / 2;
  return [
    `M${l},${o}`,
    `L${a - o},0`,
    `L${a},${o}`,
    `L${l + o},${s2}`,
    `L${a},${n - o}`,
    `L${a - o},${n}`,
    `L${l},${n - o}`,
    `L${o},${n}`,
    `L0,${n - o}`,
    `L${l - o},${s2}`,
    `L0,${o}`,
    `L${o},0`,
    "Z"
  ].join(" ");
};
var Ld = (a, n, m) => {
  const t = v(m, "adj1", 23520), o = n * t * 0.4, l = n / 2, s2 = a / 2, e = Math.min(a, n) * 0.08, d2 = l - o - e * 2, x = l + o + e * 2;
  return [
    `M0,${l - o / 2} L${a},${l - o / 2} L${a},${l + o / 2} L0,${l + o / 2} Z`,
    `M${s2 + e},${d2} A${e},${e} 0 1 0 ${s2 - e},${d2} A${e},${e} 0 1 0 ${s2 + e},${d2} Z`,
    `M${s2 + e},${x} A${e},${e} 0 1 0 ${s2 - e},${x} A${e},${e} 0 1 0 ${s2 + e},${x} Z`
  ].join(" ");
};
var ud = (a, n, m) => {
  const t = v(m, "adj1", 23520), o = n * t * 0.4, l = n * 0.15, s2 = n / 2;
  return [
    `M0,${s2 - l / 2 - o} L${a},${s2 - l / 2 - o} L${a},${s2 - l / 2} L0,${s2 - l / 2} Z`,
    `M0,${s2 + l / 2} L${a},${s2 + l / 2} L${a},${s2 + l / 2 + o} L0,${s2 + l / 2 + o} Z`
  ].join(" ");
};
var Ad = (a, n, m) => {
  const t = v(m, "adj1", 23520), o = n * t * 0.4, l = n * 0.15, s2 = n / 2, e = a * 0.08;
  return [
    `M0,${s2 - l / 2 - o} L${a},${s2 - l / 2 - o} L${a},${s2 - l / 2} L0,${s2 - l / 2} Z`,
    `M0,${s2 + l / 2} L${a},${s2 + l / 2} L${a},${s2 + l / 2 + o} L0,${s2 + l / 2 + o} Z`,
    `M${a * 0.6 - e / 2},${n * 0.15} L${a * 0.6 + e / 2},${n * 0.15} L${a * 0.4 + e / 2},${n * 0.85} L${a * 0.4 - e / 2},${n * 0.85} Z`
  ].join(" ");
};
var bd = (a, n, m) => {
  const t = v(m, "adj1", 45e3), o = v(m, "adj2", 45e3), l = a * o, s2 = n * t;
  return `M0,0 L${l},0 L${l},${n - s2} L${a},${n - s2} L${a},${n} L0,${n} Z`;
};
var jd = (a, n, m) => {
  const t = n * v(m, "adj1", 18750), o = a * v(m, "adj2", -8333), l = n * v(m, "adj3", 18750), s2 = a * v(m, "adj4", -16667), e = n * v(m, "adj5", 112500), d2 = a * v(m, "adj6", -46667);
  return [
    `M0,0 L${a},0 L${a},${n} L0,${n} Z`,
    `M${o},${t} L${s2},${l} L${d2},${e}`
  ].join(" ");
};
var $d = (a, n, m) => {
  v(m, "adj1", 25e3);
  const t = v(m, "adj2", 5e4), o = v(m, "adj3", 25e3), l = a * o, s2 = a - l, e = n / 2, d2 = n * t, x = e - d2 / 2, g = e + d2 / 2;
  return [
    `M0,${x}`,
    `C${s2 * 0.5},${x} ${s2},${x * 0.3 + e * 0.7} ${s2},${x}`,
    `L${s2},0`,
    `L${a},${e}`,
    `L${s2},${n}`,
    `L${s2},${g}`,
    `C${s2},${g * 0.3 + e * 0.7} ${s2 * 0.5},${g} 0,${g}`,
    "Z"
  ].join(" ");
};
var Pa = (a, n) => `M0,0 L${a},${n}`;
var Rd = (a, n) => `M0,0 L${a / 2},0 L${a / 2},${n} L${a},${n}`;
var Yd = (a, n) => `M0,0 L0,${n / 2} L${a},${n / 2} L${a},${n}`;
var Xd = (a, n) => `M0,0 L${a / 3},0 L${a / 3},${n} L${a * 2 / 3},${n} L${a * 2 / 3},0 L${a},0`;
var Cd = (a, n) => `M0,0 C${a / 2},0 ${a / 2},${n} ${a},${n}`;
var Fd = (a, n) => `M0,0 C0,${n / 2} ${a},${n / 2} ${a},${n}`;
var Bd = (a, n) => `M0,0 C${a / 3},0 ${a / 3},${n / 2} ${a / 2},${n / 2} C${a * 2 / 3},${n / 2} ${a * 2 / 3},${n} ${a},${n}`;
var kd = (a, n) => `M0,0 L${a},0 L${a},${n} L0,${n} Z`;
var qd = {
  // Basic shapes
  rect: Za,
  roundRect: $s,
  ellipse: Rs,
  triangle: Ys,
  rtTriangle: Xs,
  diamond: Cs,
  parallelogram: Fs,
  trapezoid: Bs,
  // Polygons
  pentagon: ks,
  hexagon: qs,
  octagon: Ms,
  heptagon: Ps,
  decagon: Ss,
  dodecagon: Os,
  // Arrows
  rightArrow: Is,
  leftArrow: Ds,
  upArrow: Es,
  downArrow: zs,
  leftRightArrow: Gs,
  upDownArrow: Hs,
  quadArrow: Ns,
  chevron: Zs,
  homePlate: _s,
  notchedRightArrow: Vs,
  stripedRightArrow: Ws,
  // Stars
  star4: Qs,
  star5: Us,
  star6: Ks,
  star7: Js,
  star8: ae,
  star10: ne,
  star12: me,
  star16: te,
  star24: oe,
  star32: le,
  // Callouts
  wedgeRectCallout: se,
  wedgeRoundRectCallout: ee,
  wedgeEllipseCallout: de,
  cloudCallout: xe,
  // Misc
  plus: vn,
  mathPlus: vn,
  donut: ge,
  cloud: Gn,
  heart: ce,
  lightningBolt: re,
  foldedCorner: pe,
  frame: ie,
  blockArc: fe,
  arc: he,
  moon: ye,
  sun: Te,
  can: we,
  cube: ve,
  teardrop: Le,
  pie: ue,
  chord: Ae,
  corner: be,
  diagStripe: je,
  plaque: $e,
  bevel: Re,
  noSmoking: Ye,
  wave: Xe,
  doubleWave: Ce,
  irregularSeal1: Fe,
  irregularSeal2: Be,
  // Rounded rect variants
  round1Rect: ke,
  round2SameRect: qe,
  round2DiagRect: Me,
  snip1Rect: Pe,
  snip2SameRect: Se,
  snip2DiagRect: Oe,
  snipRoundRect: Ie,
  // Flowchart
  flowChartProcess: De,
  flowChartDecision: Ee,
  flowChartTerminator: ze,
  flowChartPredefinedProcess: Ge,
  flowChartInputOutput: He,
  flowChartDocument: Ne,
  flowChartMultidocument: Ze,
  flowChartPreparation: _e,
  flowChartManualInput: Ve,
  flowChartManualOperation: We,
  flowChartConnector: Qe,
  flowChartOffpageConnector: Ue,
  flowChartAlternateProcess: Ke,
  flowChartDelay: Je,
  flowChartExtract: ad,
  flowChartMerge: nd,
  flowChartSort: md,
  flowChartSummingJunction: td,
  flowChartOr: od,
  flowChartCollate: ld,
  flowChartMagneticDisk: sd,
  flowChartMagneticTape: ed,
  flowChartPunchedCard: dd,
  flowChartPunchedTape: xd,
  flowChartOnlineStorage: gd,
  flowChartInternalStorage: cd,
  flowChartDisplay: rd,
  // Brackets and Braces
  leftBracket: pd,
  rightBracket: id,
  bracketPair: fd,
  leftBrace: hd,
  rightBrace: yd,
  bracePair: Td,
  // Math
  mathMinus: wd,
  mathMultiply: vd,
  mathDivide: Ld,
  mathEqual: ud,
  mathNotEqual: Ad,
  // Lines and Connectors
  line: Pa,
  straightConnector1: Pa,
  bentConnector2: Pa,
  bentConnector3: Rd,
  bentConnector4: Yd,
  bentConnector5: Xd,
  curvedConnector2: Pa,
  curvedConnector3: Cd,
  curvedConnector4: Fd,
  curvedConnector5: Bd,
  // Text
  textBox: kd,
  textNoShape: Za,
  // Additional shapes
  angle: bd,
  borderCallout2: jd,
  curvedRightArrow: $d,
  // Action buttons (simplified to rect)
  actionButtonBlank: Za
};
function Sd(a, n, m) {
  return a ? a.replace(
    /([MLCHQSTAZ])\s*([-\d.,e\s]+)?/gi,
    (t, o, l) => {
      if (!l || o.toUpperCase() === "Z") return o;
      const s2 = l.trim().split(/[\s,]+/).map(Number), e = [];
      for (let d2 = 0; d2 < s2.length; d2++)
        if (o.toUpperCase() === "A") {
          const x = d2 % 7;
          x === 0 || x === 5 ? e.push(s2[d2] * n) : x === 1 || x === 6 ? e.push(s2[d2] * m) : e.push(s2[d2]);
        } else
          e.push(s2[d2] * (d2 % 2 === 0 ? n : m));
      return `${o}${e.map((d2) => Math.round(d2 * 100) / 100).join(",")}`;
    }
  ) : "";
}
function Wx(a, n, m) {
  if (a.kind === "custom")
    return Sd(a.pathData, n, m);
  if (bs(a.preset)) {
    const o = As(a.preset, n, m, a.adjustValues);
    if (o) return o;
  }
  const t = qd[a.preset];
  return t ? t(n, m, a.adjustValues) : `M0,0 L${n},0 L${n},${m} L0,${m} Z`;
}
var Od = 12700;
function q(a) {
  return a / Od;
}
function za(a) {
  return a / 6e4;
}
function V(a) {
  return a / 1e5;
}
function sa(a) {
  return a / 100;
}
function W(a) {
  const n = a.replace("#", "");
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16)
  ];
}
function G(a, n, m) {
  const t = (o) => Math.max(0, Math.min(255, Math.round(o)));
  return "#" + [t(a), t(n), t(m)].map((o) => o.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function ha(a, n, m) {
  a /= 255, n /= 255, m /= 255;
  const t = Math.max(a, n, m), o = Math.min(a, n, m), l = (t + o) / 2;
  if (t === o) return [0, 0, l];
  const s2 = t - o, e = l > 0.5 ? s2 / (2 - t - o) : s2 / (t + o);
  let d2 = 0;
  return t === a ? d2 = ((n - m) / s2 + (n < m ? 6 : 0)) / 6 : t === n ? d2 = ((m - a) / s2 + 2) / 6 : d2 = ((a - n) / s2 + 4) / 6, [d2, e, l];
}
function ya(a, n, m) {
  if (n === 0) {
    const s2 = Math.round(m * 255);
    return [s2, s2, s2];
  }
  const t = (s2, e, d2) => (d2 < 0 && (d2 += 1), d2 > 1 && (d2 -= 1), d2 < 1 / 6 ? s2 + (e - s2) * 6 * d2 : d2 < 1 / 2 ? e : d2 < 2 / 3 ? s2 + (e - s2) * (2 / 3 - d2) * 6 : s2), o = m < 0.5 ? m * (1 + n) : m + n - m * n, l = 2 * m - o;
  return [
    Math.round(t(l, o, a + 1 / 3) * 255),
    Math.round(t(l, o, a) * 255),
    Math.round(t(l, o, a - 1 / 3) * 255)
  ];
}
function Ed(a, n) {
  const [m, t, o] = W(a), [l, s2, e] = ha(m, t, o), [d2, x, g] = ya(l, s2, Math.min(1, e * n));
  return G(d2, x, g);
}
function zd(a, n) {
  const [m, t, o] = W(a), [l, s2, e] = ha(m, t, o), [d2, x, g] = ya(l, s2, Math.min(1, Math.max(0, e + n)));
  return G(d2, x, g);
}
function Gd(a, n) {
  const [m, t, o] = W(a);
  return G(
    m + (255 - m) * n,
    t + (255 - t) * n,
    o + (255 - o) * n
  );
}
function Hd(a, n) {
  const [m, t, o] = W(a);
  return G(m * n, t * n, o * n);
}
function Nd(a, n) {
  const [m, t, o] = W(a), [l, s2, e] = ha(m, t, o), [d2, x, g] = ya(l, Math.min(1, s2 * n), e);
  return G(d2, x, g);
}
function Zd(a, n) {
  const [m, t, o] = W(a), [l, s2, e] = ha(m, t, o), [d2, x, g] = ya(l, Math.min(1, Math.max(0, s2 + n)), e);
  return G(d2, x, g);
}
function _d(a, n) {
  const [m, t, o] = W(a), [l, s2, e] = ha(m, t, o), d2 = (l * n % 1 + 1) % 1, [x, g, c] = ya(d2, s2, e);
  return G(x, g, c);
}
function Vd(a, n) {
  const [m, t, o] = W(a), [l, s2, e] = ha(m, t, o), d2 = ((l + n / 360) % 1 + 1) % 1, [x, g, c] = ya(d2, s2, e);
  return G(x, g, c);
}
function Wd(a) {
  const [n, m, t] = W(a);
  return G(255 - n, 255 - m, 255 - t);
}
function Qd(a, n, m) {
  const [t, o, l] = W(a), s2 = Math.max(0, Math.min(1, m)) * 255;
  return n === "r" ? G(s2, o, l) : n === "g" ? G(t, s2, l) : G(t, o, s2);
}
function Ud(a, n, m) {
  const [t, o, l] = W(a);
  return n === "r" ? G(t * m, o, l) : n === "g" ? G(t, o * m, l) : G(t, o, l * m);
}
function Kd(a, n, m) {
  const [t, o, l] = W(a), s2 = m * 255;
  return n === "r" ? G(t + s2, o, l) : n === "g" ? G(t, o + s2, l) : G(t, o, l + s2);
}
function Jd(a) {
  const [n, m, t] = W(a), o = 0.299 * n + 0.587 * m + 0.114 * t;
  return G(o, o, o);
}
function a0(a) {
  const [n, m, t] = W(a), [o, l, s2] = ha(n, m, t), [e, d2, x] = ya((o + 0.5) % 1, l, s2);
  return G(e, d2, x);
}
function n0(a) {
  const [n, m, t] = W(a), o = (l) => Math.pow(l / 255, 2.2) * 255;
  return G(o(n), o(m), o(t));
}
function m0(a) {
  const [n, m, t] = W(a), o = (l) => Math.pow(l / 255, 1 / 2.2) * 255;
  return G(o(n), o(m), o(t));
}
var Ln = {
  "3dDkShadow": "#696969",
  "3dLight": "#C0C0C0",
  activeBorder: "#B4B4B4",
  activeCaption: "#99B4D1",
  appWorkspace: "#ABABAB",
  background: "#FFFFFF",
  btnFace: "#F0F0F0",
  btnHighlight: "#FFFFFF",
  btnShadow: "#A0A0A0",
  btnText: "#000000",
  captionText: "#000000",
  gradientActiveCaption: "#B9D1EA",
  gradientInactiveCaption: "#D7E4F2",
  grayText: "#6D6D6D",
  highlight: "#0078D7",
  highlightText: "#FFFFFF",
  hotLight: "#0066CC",
  inactiveBorder: "#F4F7FC",
  inactiveCaption: "#BFCDDB",
  inactiveCaptionText: "#000000",
  infoBk: "#FFFFE1",
  infoText: "#000000",
  menu: "#F0F0F0",
  menuBar: "#F0F0F0",
  menuHighlight: "#3399FF",
  menuText: "#000000",
  scrollBar: "#C8C8C8",
  window: "#FFFFFF",
  windowFrame: "#646464",
  windowText: "#000000"
};
var un = {
  aliceBlue: "#F0F8FF",
  antiqueWhite: "#FAEBD7",
  aqua: "#00FFFF",
  aquamarine: "#7FFFD4",
  azure: "#F0FFFF",
  beige: "#F5F5DC",
  bisque: "#FFE4C4",
  black: "#000000",
  blanchedAlmond: "#FFEBCD",
  blue: "#0000FF",
  blueViolet: "#8A2BE2",
  brown: "#A52A2A",
  burlyWood: "#DEB887",
  cadetBlue: "#5F9EA0",
  chartreuse: "#7FFF00",
  chocolate: "#D2691E",
  coral: "#FF7F50",
  cornflowerBlue: "#6495ED",
  cornsilk: "#FFF8DC",
  crimson: "#DC143C",
  cyan: "#00FFFF",
  darkBlue: "#00008B",
  darkCyan: "#008B8B",
  darkGoldenrod: "#B8860B",
  darkGray: "#A9A9A9",
  darkGreen: "#006400",
  darkGrey: "#A9A9A9",
  darkKhaki: "#BDB76B",
  darkMagenta: "#8B008B",
  darkOliveGreen: "#556B2F",
  darkOrange: "#FF8C00",
  darkOrchid: "#9932CC",
  darkRed: "#8B0000",
  darkSalmon: "#E9967A",
  darkSeaGreen: "#8FBC8F",
  darkSlateBlue: "#483D8B",
  darkSlateGray: "#2F4F4F",
  darkSlateGrey: "#2F4F4F",
  darkTurquoise: "#00CED1",
  darkViolet: "#9400D3",
  deepPink: "#FF1493",
  deepSkyBlue: "#00BFFF",
  dimGray: "#696969",
  dimGrey: "#696969",
  dkBlue: "#00008B",
  dkCyan: "#008B8B",
  dkGoldenrod: "#B8860B",
  dkGray: "#A9A9A9",
  dkGreen: "#006400",
  dkGrey: "#A9A9A9",
  dkKhaki: "#BDB76B",
  dkMagenta: "#8B008B",
  dkOliveGreen: "#556B2F",
  dkOrange: "#FF8C00",
  dkOrchid: "#9932CC",
  dkRed: "#8B0000",
  dkSalmon: "#E9967A",
  dkSeaGreen: "#8FBC8F",
  dkSlateBlue: "#483D8B",
  dkSlateGray: "#2F4F4F",
  dkSlateGrey: "#2F4F4F",
  dkTurquoise: "#00CED1",
  dkViolet: "#9400D3",
  dodgerBlue: "#1E90FF",
  firebrick: "#B22222",
  floralWhite: "#FFFAF0",
  forestGreen: "#228B22",
  fuchsia: "#FF00FF",
  gainsboro: "#DCDCDC",
  ghostWhite: "#F8F8FF",
  gold: "#FFD700",
  goldenrod: "#DAA520",
  gray: "#808080",
  green: "#008000",
  greenYellow: "#ADFF2F",
  grey: "#808080",
  honeydew: "#F0FFF0",
  hotPink: "#FF69B4",
  indianRed: "#CD5C5C",
  indigo: "#4B0082",
  ivory: "#FFFFF0",
  khaki: "#F0E68C",
  lavender: "#E6E6FA",
  lavenderBlush: "#FFF0F5",
  lawnGreen: "#7CFC00",
  lemonChiffon: "#FFFACD",
  lightBlue: "#ADD8E6",
  lightCoral: "#F08080",
  lightCyan: "#E0FFFF",
  lightGoldenrodYellow: "#FAFAD2",
  lightGray: "#D3D3D3",
  lightGreen: "#90EE90",
  lightGrey: "#D3D3D3",
  lightPink: "#FFB6C1",
  lightSalmon: "#FFA07A",
  lightSeaGreen: "#20B2AA",
  lightSkyBlue: "#87CEFA",
  lightSlateGray: "#778899",
  lightSlateGrey: "#778899",
  lightSteelBlue: "#B0C4DE",
  lightYellow: "#FFFFE0",
  lime: "#00FF00",
  limeGreen: "#32CD32",
  linen: "#FAF0E6",
  ltBlue: "#ADD8E6",
  ltCoral: "#F08080",
  ltCyan: "#E0FFFF",
  ltGoldenrodYellow: "#FAFAD2",
  ltGray: "#D3D3D3",
  ltGreen: "#90EE90",
  ltGrey: "#D3D3D3",
  ltPink: "#FFB6C1",
  ltSalmon: "#FFA07A",
  ltSeaGreen: "#20B2AA",
  ltSkyBlue: "#87CEFA",
  ltSlateGray: "#778899",
  ltSlateGrey: "#778899",
  ltSteelBlue: "#B0C4DE",
  ltYellow: "#FFFFE0",
  magenta: "#FF00FF",
  maroon: "#800000",
  medAquamarine: "#66CDAA",
  medBlue: "#0000CD",
  medOrchid: "#BA55D3",
  medPurple: "#9370DB",
  medSeaGreen: "#3CB371",
  medSlateBlue: "#7B68EE",
  medSpringGreen: "#00FA9A",
  medTurquoise: "#48D1CC",
  medVioletRed: "#C71585",
  mediumAquamarine: "#66CDAA",
  mediumBlue: "#0000CD",
  mediumOrchid: "#BA55D3",
  mediumPurple: "#9370DB",
  mediumSeaGreen: "#3CB371",
  mediumSlateBlue: "#7B68EE",
  mediumSpringGreen: "#00FA9A",
  mediumTurquoise: "#48D1CC",
  mediumVioletRed: "#C71585",
  midnightBlue: "#191970",
  mintCream: "#F5FFFA",
  mistyRose: "#FFE4E1",
  moccasin: "#FFE4B5",
  navajoWhite: "#FFDEAD",
  navy: "#000080",
  oldLace: "#FDF5E6",
  olive: "#808000",
  oliveDrab: "#6B8E23",
  orange: "#FFA500",
  orangeRed: "#FF4500",
  orchid: "#DA70D6",
  paleGoldenrod: "#EEE8AA",
  paleGreen: "#98FB98",
  paleTurquoise: "#AFEEEE",
  paleVioletRed: "#DB7093",
  papayaWhip: "#FFEFD5",
  peachPuff: "#FFDAB9",
  peru: "#CD853F",
  pink: "#FFC0CB",
  plum: "#DDA0DD",
  powderBlue: "#B0E0E6",
  purple: "#800080",
  red: "#FF0000",
  rosyBrown: "#BC8F8F",
  royalBlue: "#4169E1",
  saddleBrown: "#8B4513",
  salmon: "#FA8072",
  sandyBrown: "#F4A460",
  seaGreen: "#2E8B57",
  seaShell: "#FFF5EE",
  sienna: "#A0522D",
  silver: "#C0C0C0",
  skyBlue: "#87CEEB",
  slateBlue: "#6A5ACD",
  slateGray: "#708090",
  slateGrey: "#708090",
  snow: "#FFFAFA",
  springGreen: "#00FF7F",
  steelBlue: "#4682B4",
  tan: "#D2B48C",
  teal: "#008080",
  thistle: "#D8BFD8",
  tomato: "#FF6347",
  turquoise: "#40E0D0",
  violet: "#EE82EE",
  wheat: "#F5DEB3",
  white: "#FFFFFF",
  whiteSmoke: "#F5F5F5",
  yellow: "#FFFF00",
  yellowGreen: "#9ACD32"
};
function C(a) {
  return a == null ? [] : Array.isArray(a) ? a : [a];
}
function w(a, n) {
  const m = a[`@_${n}`];
  if (m != null)
    return String(m);
}
function y(a, n) {
  const m = w(a, n);
  if (m === void 0) return;
  const t = Number(m);
  return isNaN(t) ? void 0 : t;
}
var t0 = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (a) => a === "Relationship"
});
function Hn(a) {
  var o;
  const n = /* @__PURE__ */ new Map(), m = t0.parse(a), t = (o = m == null ? void 0 : m.Relationships) == null ? void 0 : o.Relationship;
  if (!t) return n;
  for (const l of C(t)) {
    const s2 = l["@_Id"], e = l["@_Type"], d2 = l["@_Target"];
    if (s2 && e && d2) {
      const x = e.split("/").pop() ?? e;
      n.set(s2, { type: x, target: d2 });
    }
  }
  return n;
}
function K(a, n) {
  if (n.startsWith("/"))
    return n.slice(1);
  const m = a.replace(/\\/g, "/").split("/"), t = n.replace(/\\/g, "/").split("/");
  for (const o of t)
    o === ".." ? m.pop() : o !== "." && m.push(o);
  return m.join("/");
}
var o0 = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  processEntities: true,
  htmlEntities: true
});
var l0 = [
  "dk1",
  "dk2",
  "lt1",
  "lt2",
  "accent1",
  "accent2",
  "accent3",
  "accent4",
  "accent5",
  "accent6",
  "hlink",
  "folHlink"
];
var _a = {
  dk1: "#000000",
  dk2: "#44546A",
  lt1: "#FFFFFF",
  lt2: "#E7E6E6",
  accent1: "#4472C4",
  accent2: "#ED7D31",
  accent3: "#A5A5A5",
  accent4: "#FFC000",
  accent5: "#5B9BD5",
  accent6: "#70AD47",
  hlink: "#0563C1",
  folHlink: "#954F72"
};
function s0(a) {
  if (!a || typeof a != "object") return;
  const n = a, m = n.srgbClr;
  if (m) {
    const o = m["@_val"];
    if (o) return "#" + o.toUpperCase();
  }
  const t = n.sysClr;
  if (t) {
    const o = t["@_lastClr"];
    if (o) return "#" + o.toUpperCase();
    const l = t["@_val"];
    if (l === "windowText" || l === "windowFrame") return "#000000";
    if (l === "window" || l === "highlightText") return "#FFFFFF";
  }
}
function An(a, n, m, t) {
  const o = new RegExp(
    `<[^:]*:?${n}\\b[^>]*>([\\s\\S]*?)<\\/[^:]*:?${n}>`
  ), l = a.match(o);
  if (!l) return [];
  const s2 = l[1], e = new RegExp(`<[^:]*:?(${t.join("|")})\\b`, "g"), d2 = {}, x = [];
  let g;
  for (; (g = e.exec(s2)) !== null; ) {
    const c = g[1], r = d2[c] ?? 0;
    d2[c] = r + 1;
    const p = m[c];
    let i;
    Array.isArray(p) ? i = p[r] : r === 0 && (i = p), i && typeof i == "object" && x.push({ _type: c, ...i });
  }
  return x;
}
var bn = ["solidFill", "gradFill", "blipFill", "pattFill", "noFill"];
function jn(a) {
  const n = o0.parse(a), m = n == null ? void 0 : n.theme;
  if (!m)
    return { colors: { ..._a }, fonts: { majorLatin: "Calibri", minorLatin: "Calibri" } };
  const t = m.themeElements;
  if (!t)
    return { colors: { ..._a }, fonts: { majorLatin: "Calibri", minorLatin: "Calibri" } };
  const o = t.clrScheme, l = { ..._a };
  if (o)
    for (const r of l0) {
      const p = s0(o[r]);
      p && (l[r] = p);
    }
  const s2 = t.fontScheme, e = {
    majorLatin: "Calibri",
    minorLatin: "Calibri"
  };
  if (s2) {
    const r = s2.majorFont, p = s2.minorFont;
    if (r) {
      const i = r.latin;
      if (i) {
        const h = i["@_typeface"];
        h && (e.majorLatin = h);
      }
      const f = r.ea;
      if (f) {
        const h = f["@_typeface"];
        h && (e.majorEastAsia = h);
      }
    }
    if (p) {
      const i = p.latin;
      if (i) {
        const h = i["@_typeface"];
        h && (e.minorLatin = h);
      }
      const f = p.ea;
      if (f) {
        const h = f["@_typeface"];
        h && (e.minorEastAsia = h);
      }
    }
  }
  const d2 = t.fmtScheme;
  let x, g, c;
  if (d2) {
    const r = d2.bgFillStyleLst;
    r && (x = An(a, "bgFillStyleLst", r, bn));
    const p = d2.fillStyleLst;
    p && (g = An(a, "fillStyleLst", p, bn));
    const i = d2.lnStyleLst;
    if (i) {
      const f = i.ln;
      Array.isArray(f) ? c = f.slice() : f && typeof f == "object" && (c = [f]);
    }
  }
  return { colors: l, fonts: e, bgFillStyles: x, fillStyles: g, lnStyles: c };
}
function Nn(a, n) {
  if (a === "bg1" || a === "tx1" || a === "bg2" || a === "tx2") {
    const o = n[a];
    if (o !== void 0) return o;
  }
  const t = {
    bg1: "lt1",
    bg2: "lt2",
    tx1: "dk1",
    tx2: "dk2",
    dk1: "dk1",
    dk2: "dk2",
    lt1: "lt1",
    lt2: "lt2",
    accent1: "accent1",
    accent2: "accent2",
    accent3: "accent3",
    accent4: "accent4",
    accent5: "accent5",
    accent6: "accent6",
    hlink: "hlink",
    folHlink: "folHlink"
  }[a];
  if (t) return n[t];
}
function Va(a, n) {
  const m = { ...a }, t = ["bg1", "tx1", "bg2", "tx2"];
  for (const o of t) {
    const l = n[o];
    if (l) {
      const s2 = a[l];
      s2 !== void 0 && (m[o] = s2);
    }
  }
  return m;
}
var Zn = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  processEntities: true,
  htmlEntities: true,
  isArray: (a) => ["sp", "pic", "grpSp", "graphicFrame", "p", "r", "br", "Relationship"].includes(a)
});
var Qa = {
  bg1: "lt1",
  bg2: "lt2",
  tx1: "dk1",
  tx2: "dk2",
  dk1: "dk1",
  dk2: "dk2",
  lt1: "lt1",
  lt2: "lt2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hlink: "hlink",
  folHlink: "folHlink"
};
function Sa(a, n) {
  if (!a || typeof a != "object") return {};
  const m = a, t = {}, o = y(m, "sz");
  o !== void 0 && (t.fontSize = o / 100);
  const l = w(m, "b");
  l !== void 0 && (t.bold = l === "1" || l === "true");
  const s2 = w(m, "i");
  s2 !== void 0 && (t.italic = s2 === "1" || s2 === "true");
  const e = w(m, "algn");
  e && (t.alignment = e);
  const d2 = w(m, "u");
  d2 === "sng" ? t.underline = "single" : d2 === "dbl" ? t.underline = "double" : d2 === "none" && (t.underline = "none");
  const x = w(m, "strike");
  x === "sngStrike" || x === "dblStrike" ? t.strikethrough = true : x === "noStrike" && (t.strikethrough = false);
  const g = y(m, "spc");
  g !== void 0 && (t.letterSpacing = sa(g));
  const c = y(m, "baseline");
  c !== void 0 && (t.baseline = c / 1e3);
  const r = m.latin;
  if (r) {
    const j = w(r, "typeface");
    j && (t.fontFamily = j);
  }
  const p = m.ea;
  if (p) {
    const j = w(p, "typeface");
    j && (t.eaFontFamily = j);
  }
  const i = m.solidFill;
  if (i) {
    const j = i.srgbClr;
    if (j) {
      const R = w(j, "val");
      R && (t.color = "#" + R.toUpperCase());
    }
    if (!t.color && n) {
      const R = i.schemeClr;
      if (R) {
        const Y2 = w(R, "val");
        if (Y2) {
          const $ = n;
          if ($[Y2])
            t.color = $[Y2];
          else {
            const b = Qa[Y2];
            b && $[b] && (t.color = $[b]);
          }
        }
      }
    }
  }
  const f = m.lnSpc;
  f && (t.lineSpacing = e0(f));
  const h = m.spcBef;
  h && (t.spaceBefore = $n(h));
  const L = m.spcAft;
  L && (t.spaceAfter = $n(L));
  const u = y(m, "indent");
  u !== void 0 && (t.indent = q(u));
  const A = y(m, "marL");
  A !== void 0 && (t.marginLeft = q(A));
  const T = d0(m, n);
  return T === "none" ? t.bulletNone = true : T && (t.bullet = T), t;
}
function e0(a) {
  const n = a.spcPct;
  if (n) {
    const t = y(n, "val");
    if (t !== void 0) return { value: t / 1e3, unit: "percent" };
  }
  const m = a.spcPts;
  if (m) {
    const t = y(m, "val");
    if (t !== void 0) return { value: sa(t), unit: "pt" };
  }
}
function $n(a) {
  const n = a.spcPts;
  if (n) {
    const t = y(n, "val");
    if (t !== void 0) return { value: sa(t), unit: "pt" };
  }
  const m = a.spcPct;
  if (m) {
    const t = y(m, "val");
    if (t !== void 0) return { value: t / 1e3, unit: "percent" };
  }
}
function d0(a, n) {
  const m = a.buChar;
  if (m) {
    const o = w(m, "char");
    if (o) {
      const l = { type: "char", char: o };
      return Rn(l, a, n), l;
    }
  }
  const t = a.buAutoNum;
  if (t) {
    const o = y(t, "startAt") ?? 1, l = w(t, "type"), s2 = { type: "number", startAt: o, numberType: l };
    return Rn(s2, a, n), s2;
  }
  if (a.buNone !== void 0) return "none";
}
function Rn(a, n, m) {
  const t = n.buSzPct;
  if (t) {
    const e = y(t, "val");
    e !== void 0 && (a.fontSizePercent = e / 1e5);
  }
  const o = n.buSzPts;
  if (o) {
    const e = y(o, "val");
    e !== void 0 && (a.fontSize = e / 100);
  }
  const l = n.buClr;
  if (l) {
    const e = x0(l, m);
    e && (a.color = e);
  }
  const s2 = n.buFont;
  if (s2) {
    const e = w(s2, "typeface");
    e && !e.startsWith("+") && (a.fontFamily = e);
  }
}
function x0(a, n) {
  const m = a.srgbClr;
  if (m) {
    const t = w(m, "val");
    if (t) return { hex: "#" + t.toUpperCase(), alpha: 1 };
  }
  if (n) {
    const t = a.schemeClr;
    if (t) {
      const o = w(t, "val");
      if (o) {
        const l = n, s2 = l[o] ?? (Qa[o] ? l[Qa[o]] : void 0);
        if (s2) return { hex: s2, alpha: 1 };
      }
    }
  }
}
function Ia(a, n) {
  const m = { levels: {} };
  if (!a || typeof a != "object") return m;
  const t = a;
  let o;
  const l = t.defPPr;
  if (l && typeof l == "object") {
    o = Sa(l, n);
    const s2 = l.defRPr;
    if (s2) {
      const e = Sa(s2, n);
      Wa(o, e);
    }
  }
  for (let s2 = 1; s2 <= 9; s2++) {
    const e = t[`lvl${s2}pPr`];
    if (e) {
      const d2 = Sa(e, n), x = e.defRPr;
      if (x) {
        const g = Sa(x, n);
        Wa(d2, g);
      }
      if (o) {
        const g = { ...o };
        Wa(g, d2), m.levels[s2 - 1] = g;
      } else
        m.levels[s2 - 1] = d2;
    } else o && (m.levels[s2 - 1] = { ...o });
  }
  return o && !m.levels[0] && (m.levels[0] = { ...o }), m;
}
function Wa(a, n) {
  for (const [m, t] of Object.entries(n))
    t !== void 0 && (a[m] = t);
}
function _n(a, n) {
  if (!a || typeof a != "object") return [];
  const t = C(a.sp), o = [];
  for (const l of t) {
    if (!l || typeof l != "object") continue;
    const s2 = l, e = s2.nvSpPr;
    if (!e) continue;
    const d2 = e.nvPr;
    if (!d2) continue;
    const x = d2.ph;
    if (!x) continue;
    const g = {}, c = w(x, "type");
    c && (g.type = c);
    const r = y(x, "idx");
    r !== void 0 && (g.idx = r);
    const p = s2.spPr;
    if (p) {
      g.spPrNode = p;
      const h = p.xfrm;
      if (h) {
        const L = h.off;
        if (L) {
          const A = y(L, "x"), T = y(L, "y");
          A !== void 0 && T !== void 0 && (g.position = { x: q(A), y: q(T) });
        }
        const u = h.ext;
        if (u) {
          const A = y(u, "cx"), T = y(u, "cy");
          A !== void 0 && T !== void 0 && (g.size = { width: q(A), height: q(T) });
        }
      }
    }
    const i = s2.style;
    i && (g.styleNode = i);
    const f = s2.txBody;
    if (f) {
      const h = f.bodyPr;
      h && (g.bodyPrNode = h);
      const L = f.lstStyle;
      L && (g.lstStyleNode = L, g.textDefaults = Ia(L, n));
    }
    o.push(g);
  }
  return o;
}
function g0(a, n) {
  const m = Zn.parse(a), t = m == null ? void 0 : m.sldMaster;
  if (!t)
    return { placeholders: [] };
  const o = t.cSld, l = o == null ? void 0 : o.spTree, s2 = _n(l, n), e = t.txStyles, d2 = e ? Ua(e, n) : void 0, x = { placeholders: s2 };
  return d2 && (x.textStyles = d2), e && (x.txStylesNode = e), x;
}
function Ua(a, n) {
  if (!a || typeof a != "object") return;
  const m = a, t = {};
  return m.titleStyle && (t.titleStyle = Ia(m.titleStyle, n)), m.bodyStyle && (t.bodyStyle = Ia(m.bodyStyle, n)), m.otherStyle && (t.otherStyle = Ia(m.otherStyle, n)), t;
}
function c0(a, n) {
  const m = Zn.parse(a), t = m == null ? void 0 : m.sldLayout;
  if (!t)
    return { placeholders: [] };
  const o = t.cSld, l = o == null ? void 0 : o.spTree, s2 = _n(l, n), e = w(
    t,
    "type"
  );
  return { placeholders: s2, type: e };
}
function r0(a) {
  if (a.length >= 24 && a[0] === 137 && a[1] === 80 && a[2] === 78 && a[3] === 71) {
    const n = a[16] << 24 | a[17] << 16 | a[18] << 8 | a[19], m = a[20] << 24 | a[21] << 16 | a[22] << 8 | a[23];
    if (n > 0 && m > 0) return { width: n >>> 0, height: m >>> 0 };
  }
  if (a.length >= 10 && a[0] === 71 && a[1] === 73 && a[2] === 70) {
    const n = a[6] | a[7] << 8, m = a[8] | a[9] << 8;
    if (n > 0 && m > 0) return { width: n, height: m };
  }
  if (a.length >= 4 && a[0] === 255 && a[1] === 216) {
    let n = 2;
    for (; n < a.length - 8; ) {
      if (a[n] !== 255) {
        n++;
        continue;
      }
      for (; n < a.length && a[n] === 255; ) n++;
      const m = a[n];
      if (n++, m === 216 || m === 217 || m >= 208 && m <= 215) continue;
      const t = a[n] << 8 | a[n + 1];
      if (m >= 192 && m <= 195 || m >= 197 && m <= 199 || m >= 201 && m <= 203 || m >= 205 && m <= 207) {
        const o = a[n + 3] << 8 | a[n + 4], l = a[n + 5] << 8 | a[n + 6];
        return l > 0 && o > 0 ? { width: l, height: o } : void 0;
      }
      n += t;
    }
  }
}
function Vn(a) {
  var t;
  const n = ((t = a.split(".").pop()) == null ? void 0 : t.toLowerCase()) ?? "";
  return {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    bmp: "image/bmp",
    tiff: "image/tiff",
    tif: "image/tiff",
    svg: "image/svg+xml",
    emf: "image/x-emf",
    wmf: "image/x-wmf",
    // Video
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    ogv: "video/ogg",
    avi: "video/x-msvideo",
    wmv: "video/x-ms-wmv",
    // Audio
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    wav: "audio/wav",
    ogg: "audio/ogg",
    oga: "audio/ogg",
    flac: "audio/flac",
    wma: "audio/x-ms-wma"
  }[n] ?? "application/octet-stream";
}
async function p0(a) {
  const n = /* @__PURE__ */ new Map(), m = /* @__PURE__ */ new Map(), t = a.folder("ppt/media");
  if (!t) return { images: n, dimensions: m };
  const o = [];
  return t.forEach((l, s2) => {
    s2.dir || o.push({ path: "ppt/media/" + l, file: s2 });
  }), await Promise.all(
    o.map(async ({ path: l, file: s2 }) => {
      const e = Vn(l);
      try {
        const d2 = await s2.async("arraybuffer"), x = new Uint8Array(d2), g = r0(x);
        if (g && m.set(l, g), typeof globalThis < "u" && typeof globalThis.window < "u" && typeof globalThis.document < "u" && typeof Blob < "u" && typeof URL < "u" && URL.createObjectURL) {
          const r = new Blob([d2], { type: e });
          n.set(l, URL.createObjectURL(r));
        } else {
          const r = await s2.async("base64");
          n.set(l, `data:${e};base64,${r}`);
        }
      } catch {
      }
    })
  ), { images: n, dimensions: m };
}
function Ca(a, n, m, t) {
  const o = n.get(a);
  if (!o) return;
  const l = K(m, o.target), s2 = t.images.get(l);
  if (!s2) return;
  const e = t.dimensions.get(l);
  return {
    src: s2,
    contentType: Vn(l),
    dimensions: e
  };
}
function z(a, n, m) {
  if (!a || typeof a != "object") return;
  const t = a;
  let o, l = 1, s2;
  const e = t.srgbClr;
  if (e) {
    const c = w(e, "val");
    c && (o = "#" + c.toUpperCase()), s2 = e;
  }
  const d2 = t.schemeClr;
  if (!o && d2) {
    const c = w(d2, "val");
    c === "phClr" && m ? o = m : c && n && (o = Nn(c, n)), s2 = d2;
  }
  const x = t.prstClr;
  if (!o && x) {
    const c = w(x, "val");
    c && un[c] && (o = un[c]), s2 = x;
  }
  const g = t.sysClr;
  if (!o && g) {
    const c = w(g, "lastClr");
    if (c)
      o = "#" + c.toUpperCase();
    else {
      const r = w(g, "val");
      r && Ln[r] && (o = Ln[r]);
    }
    s2 = g;
  }
  if (o) {
    if (s2) {
      o = i0(o, s2);
      const c = s2.alpha;
      if (c) {
        const r = y(c, "val");
        r !== void 0 && (l = V(r));
      }
    }
    return { hex: o, alpha: l };
  }
}
function i0(a, n) {
  const m = (c) => {
    if (c)
      return y(c, "val");
  }, t = m(n.hueMod);
  t !== void 0 && (a = _d(a, V(t)));
  const o = m(n.hueOff);
  o !== void 0 && (a = Vd(a, o / 6e4));
  const l = m(n.lumMod);
  l !== void 0 && (a = Ed(a, V(l)));
  const s2 = m(n.lumOff);
  s2 !== void 0 && (a = zd(a, V(s2)));
  const e = m(n.tint);
  e !== void 0 && (a = Gd(a, 1 - V(e)));
  const d2 = m(n.shade);
  d2 !== void 0 && (a = Hd(a, V(d2)));
  const x = m(n.satMod);
  x !== void 0 && (a = Nd(a, V(x)));
  const g = m(n.satOff);
  g !== void 0 && (a = Zd(a, V(g)));
  for (const [c, r] of [["red", "r"], ["green", "g"], ["blue", "b"]]) {
    const p = m(n[c]);
    p !== void 0 && (a = Qd(a, r, V(p)));
    const i = m(n[`${c}Mod`]);
    i !== void 0 && (a = Ud(a, r, V(i)));
    const f = m(n[`${c}Off`]);
    f !== void 0 && (a = Kd(a, r, V(f)));
  }
  return n.inv != null && (a = Wd(a)), n.gray != null && (a = Jd(a)), n.comp != null && (a = a0(a)), n.gamma != null && (a = n0(a)), n.invGamma != null && (a = m0(a)), a;
}
function f0(a) {
  const n = {
    anchor: "top",
    wrap: "square",
    margins: { top: 3.6, right: 7.2, bottom: 3.6, left: 7.2 }
    // OOXML defaults in pt
  };
  if (!a || typeof a != "object") return n;
  const m = a, t = w(m, "anchor");
  t === "ctr" ? n.anchor = "middle" : t === "b" ? n.anchor = "bottom" : t === "t" && (n.anchor = "top"), w(m, "wrap") === "none" && (n.wrap = "none");
  const l = y(m, "lIns"), s2 = y(m, "tIns"), e = y(m, "rIns"), d2 = y(m, "bIns");
  if (l !== void 0 && (n.margins.left = q(l)), s2 !== void 0 && (n.margins.top = q(s2)), e !== void 0 && (n.margins.right = q(e)), d2 !== void 0 && (n.margins.bottom = q(d2)), m.normAutofit !== void 0) {
    if (n.autoFit = "shrink", m.normAutofit && typeof m.normAutofit == "object") {
      const x = m.normAutofit, g = y(x, "fontScale");
      g !== void 0 && g > 0 && (n.fontScale = g / 1e5);
      const c = y(x, "lnSpcReduction");
      c !== void 0 && c > 0 && (n.lnSpcReduction = c / 1e5);
    }
  } else m.spAutoFit !== void 0 ? n.autoFit = "resize" : n.autoFit = "none";
  return n;
}
function Wn(a) {
  if (!a || typeof a != "object") return;
  const n = a, m = n.spcPct;
  if (m) {
    const o = y(m, "val");
    if (o !== void 0) return { value: o / 1e3, unit: "percent" };
  }
  const t = n.spcPts;
  if (t) {
    const o = y(t, "val");
    if (o !== void 0) return { value: sa(o), unit: "pt" };
  }
}
function Da(a) {
  if (!a || typeof a != "object") return;
  const n = a, m = n.spcPts;
  if (m) {
    const o = y(m, "val");
    if (o !== void 0) return { value: sa(o), unit: "pt" };
  }
  const t = n.spcPct;
  if (t) {
    const o = y(t, "val");
    if (o !== void 0) return { value: o / 1e3, unit: "percent" };
  }
}
function Yn(a, n, m) {
  const t = n.buSzPct;
  if (t) {
    const e = y(t, "val");
    e !== void 0 && (a.fontSizePercent = e / 1e5);
  }
  const o = n.buSzPts;
  if (o) {
    const e = y(o, "val");
    e !== void 0 && (a.fontSize = e / 100);
  }
  const l = n.buClr;
  if (l) {
    const e = z(l, m);
    e && (a.color = e);
  }
  const s2 = n.buFont;
  if (s2) {
    const e = w(s2, "typeface");
    e && !e.startsWith("+") && (a.fontFamily = e);
  }
}
function Qn(a, n) {
  const m = a.buChar;
  if (m) {
    const o = w(m, "char");
    if (o) {
      const l = { type: "char", char: o };
      return Yn(l, a, n), l;
    }
  }
  const t = a.buAutoNum;
  if (t) {
    const o = y(t, "startAt") ?? 1, l = w(t, "type"), s2 = { type: "number", startAt: o, numberType: l };
    return Yn(s2, a, n), s2;
  }
  a.buNone;
}
function h0(a, n, m) {
  const t = {
    alignment: (m == null ? void 0 : m.alignment) ?? "left",
    level: 0
  };
  if (m != null && m.lineSpacing && (t.lineSpacing = m.lineSpacing), m != null && m.spaceBefore && (t.spaceBefore = m.spaceBefore), m != null && m.spaceAfter && (t.spaceAfter = m.spaceAfter), (m == null ? void 0 : m.indent) !== void 0 && (t.indent = m.indent), (m == null ? void 0 : m.marginLeft) !== void 0 && (t.marginLeft = m.marginLeft), m != null && m.bullet && (t.bullet = m.bullet), !a || typeof a != "object") return t;
  const o = a, l = w(o, "algn");
  l === "ctr" ? t.alignment = "center" : l === "r" ? t.alignment = "right" : l === "just" ? t.alignment = "justify" : l === "l" && (t.alignment = "left");
  const s2 = y(o, "lvl");
  s2 !== void 0 && (t.level = s2);
  const e = o.lnSpc;
  e && (t.lineSpacing = Wn(e));
  const d2 = o.spcBef;
  d2 && (t.spaceBefore = Da(d2));
  const x = o.spcAft;
  x && (t.spaceAfter = Da(x));
  const g = y(o, "indent");
  g !== void 0 && (t.indent = q(g));
  const c = y(o, "marL");
  if (c !== void 0 && (t.marginLeft = q(c)), o.buNone !== void 0)
    t.bullet = void 0;
  else {
    const r = Qn(o, n);
    r && (t.bullet = r);
  }
  return t;
}
function Xn(a, n, m, t) {
  const o = {
    fontFamily: (t == null ? void 0 : t.fontFamily) ?? (m == null ? void 0 : m.minorLatin) ?? "Calibri",
    fontSize: (t == null ? void 0 : t.fontSize) ?? 18,
    bold: (t == null ? void 0 : t.bold) ?? false,
    italic: (t == null ? void 0 : t.italic) ?? false,
    underline: (t == null ? void 0 : t.underline) ?? "none",
    strikethrough: (t == null ? void 0 : t.strikethrough) ?? false,
    color: t == null ? void 0 : t.color,
    eaFontFamily: t == null ? void 0 : t.eaFontFamily,
    letterSpacing: t == null ? void 0 : t.letterSpacing,
    baseline: t == null ? void 0 : t.baseline
  };
  if (!a || typeof a != "object") return o;
  const l = a, s2 = l.latin;
  if (s2) {
    const h = w(s2, "typeface");
    h && (h === "+mj-lt" && m ? o.fontFamily = m.majorLatin : h === "+mn-lt" && m ? o.fontFamily = m.minorLatin : h === "+mj-ea" && (m != null && m.majorEastAsia) ? o.fontFamily = m.majorEastAsia : h === "+mn-ea" && (m != null && m.minorEastAsia) ? o.fontFamily = m.minorEastAsia : h.startsWith("+") || (o.fontFamily = h));
  }
  const e = l.ea;
  if (e) {
    const h = w(e, "typeface");
    h && (h === "+mj-ea" && (m != null && m.majorEastAsia) ? o.eaFontFamily = m.majorEastAsia : h === "+mn-ea" && (m != null && m.minorEastAsia) ? o.eaFontFamily = m.minorEastAsia : h.startsWith("+") || (o.eaFontFamily = h)), !s2 && o.eaFontFamily && (o.fontFamily = o.eaFontFamily);
  }
  const d2 = y(l, "sz");
  d2 !== void 0 && (o.fontSize = sa(d2));
  const x = w(l, "b");
  x !== void 0 && (o.bold = x === "1" || x === "true");
  const g = w(l, "i");
  g !== void 0 && (o.italic = g === "1" || g === "true");
  const c = w(l, "u");
  c === "sng" ? o.underline = "single" : c === "dbl" ? o.underline = "double" : c === "none" && (o.underline = "none");
  const r = w(l, "strike");
  (r === "sngStrike" || r === "dblStrike") && (o.strikethrough = true);
  const p = y(l, "spc");
  p !== void 0 && (o.letterSpacing = sa(p));
  const i = y(l, "baseline");
  i !== void 0 && (o.baseline = i / 1e3);
  const f = l.solidFill;
  if (f) {
    const h = z(f, n);
    h && (o.color = h);
  }
  return o;
}
function y0(a, n, m, t, o) {
  if (!a && !n && !m) return;
  const l = {};
  let s2 = false;
  return m && (m.fontFamily !== void 0 && (l.fontFamily = m.fontFamily, s2 = true), m.eaFontFamily !== void 0 && (l.eaFontFamily = m.eaFontFamily, s2 = true), m.fontSize !== void 0 && (l.fontSize = m.fontSize, s2 = true), m.bold !== void 0 && (l.bold = m.bold, s2 = true), m.italic !== void 0 && (l.italic = m.italic, s2 = true), m.color !== void 0 && (l.color = m.color, s2 = true), m.underline !== void 0 && (l.underline = m.underline, s2 = true), m.strikethrough !== void 0 && (l.strikethrough = m.strikethrough, s2 = true), m.letterSpacing !== void 0 && (l.letterSpacing = m.letterSpacing, s2 = true), m.baseline !== void 0 && (l.baseline = m.baseline, s2 = true)), n && (Cn(n, l, t, o), s2 = true), a && (Cn(a, l, t, o), s2 = true), s2 ? l : void 0;
}
function Cn(a, n, m, t) {
  const o = a.latin, l = a.ea;
  if (o) {
    const i = w(o, "typeface");
    i && (i === "+mj-lt" && t ? n.fontFamily = t.majorLatin : i === "+mn-lt" && t ? n.fontFamily = t.minorLatin : i === "+mj-ea" && (t != null && t.majorEastAsia) ? n.fontFamily = t.majorEastAsia : i === "+mn-ea" && (t != null && t.minorEastAsia) ? n.fontFamily = t.minorEastAsia : i.startsWith("+") || (n.fontFamily = i));
  } else if (l) {
    const i = w(l, "typeface");
    i && (i === "+mj-ea" && (t != null && t.majorEastAsia) ? n.fontFamily = t.majorEastAsia : i === "+mn-ea" && (t != null && t.minorEastAsia) ? n.fontFamily = t.minorEastAsia : i.startsWith("+") || (n.fontFamily = i));
  }
  if (l) {
    const i = w(l, "typeface");
    i && (i === "+mj-ea" && (t != null && t.majorEastAsia) ? n.eaFontFamily = t.majorEastAsia : i === "+mn-ea" && (t != null && t.minorEastAsia) ? n.eaFontFamily = t.minorEastAsia : i.startsWith("+") || (n.eaFontFamily = i));
  }
  const s2 = y(a, "sz");
  s2 !== void 0 && (n.fontSize = sa(s2));
  const e = w(a, "b");
  e !== void 0 && (n.bold = e === "1" || e === "true");
  const d2 = w(a, "i");
  d2 !== void 0 && (n.italic = d2 === "1" || d2 === "true");
  const x = w(a, "u");
  x === "sng" ? n.underline = "single" : x === "dbl" ? n.underline = "double" : x === "none" && (n.underline = "none");
  const g = w(a, "strike");
  g === "sngStrike" || g === "dblStrike" ? n.strikethrough = true : g === "noStrike" && (n.strikethrough = false);
  const c = y(a, "spc");
  c !== void 0 && (n.letterSpacing = sa(c));
  const r = y(a, "baseline");
  r !== void 0 && (n.baseline = r / 1e3);
  const p = a.solidFill;
  if (p) {
    const i = z(p, m);
    i && (n.color = i);
  }
}
function T0(a, n) {
  const m = {}, t = w(a, "algn");
  t === "ctr" ? m.alignment = "center" : t === "r" ? m.alignment = "right" : t === "just" ? m.alignment = "justify" : t === "l" && (m.alignment = "left");
  const o = a.lnSpc;
  o && (m.lineSpacing = Wn(o));
  const l = a.spcBef;
  l && (m.spaceBefore = Da(l));
  const s2 = a.spcAft;
  s2 && (m.spaceAfter = Da(s2));
  const e = y(a, "indent");
  e !== void 0 && (m.indent = q(e));
  const d2 = y(a, "marL");
  if (d2 !== void 0 && (m.marginLeft = q(d2)), a.buNone !== void 0)
    m.bulletNone = true;
  else {
    const x = Qn(a, n);
    x && (m.bullet = x);
  }
  return m;
}
function w0(a, n, m) {
  if (!a && !n) return;
  const t = {};
  let o = false;
  if (n && (n.alignment !== void 0 && (t.alignment = n.alignment, o = true), n.lineSpacing !== void 0 && (t.lineSpacing = n.lineSpacing, o = true), n.spaceBefore !== void 0 && (t.spaceBefore = n.spaceBefore, o = true), n.spaceAfter !== void 0 && (t.spaceAfter = n.spaceAfter, o = true), n.indent !== void 0 && (t.indent = n.indent, o = true), n.marginLeft !== void 0 && (t.marginLeft = n.marginLeft, o = true), n.bulletNone ? (t.bulletNone = true, t.bullet = void 0, o = true) : n.bullet !== void 0 && (t.bullet = n.bullet, o = true)), a) {
    const l = T0(a, m);
    l.alignment !== void 0 && (t.alignment = l.alignment, o = true), l.lineSpacing !== void 0 && (t.lineSpacing = l.lineSpacing, o = true), l.spaceBefore !== void 0 && (t.spaceBefore = l.spaceBefore, o = true), l.spaceAfter !== void 0 && (t.spaceAfter = l.spaceAfter, o = true), l.indent !== void 0 && (t.indent = l.indent, o = true), l.marginLeft !== void 0 && (t.marginLeft = l.marginLeft, o = true), l.bulletNone ? (t.bulletNone = true, t.bullet = void 0, o = true) : l.bullet !== void 0 && (t.bullet = l.bullet, t.bulletNone = false, o = true);
  }
  return o ? t : void 0;
}
function Ka(a, n = {}) {
  var g, c;
  if (!a || typeof a != "object") return;
  const m = a, t = f0(m.bodyPr), o = m.lstStyle, l = {}, s2 = {};
  let e;
  if (o && typeof o == "object") {
    for (let r = 1; r <= 9; r++) {
      const p = o[`lvl${r}pPr`];
      p && (s2[r] = p, p.defRPr && (l[r] = p.defRPr));
    }
    if (e = o.defPPr, e)
      for (let r = 1; r <= 9; r++)
        s2[r] || (s2[r] = e), e.defRPr && !l[r] && (l[r] = e.defRPr);
  }
  const d2 = C(m.p), x = [];
  for (const r of d2) {
    if (!r || typeof r != "object") continue;
    const p = r, i = p.pPr, f = i && typeof i == "object" ? i : void 0, h = f ? y(f, "lvl") ?? 0 : 0, L = h + 1, u = (g = n.externalTextDefaults) == null ? void 0 : g.levels[h], A = w0(
      s2[L] ?? s2[1],
      u == null ? void 0 : u.paragraph,
      n.themeColors
    ), T = h0(i, n.themeColors, A), j = y0(
      f == null ? void 0 : f.defRPr,
      l[L] ?? l[1],
      u == null ? void 0 : u.run,
      n.themeColors,
      n.themeFonts
    ), R = [], Y2 = [];
    for (const $ of C(p.r)) {
      if (!$ || typeof $ != "object") continue;
      const b = $, F = y(b, "__pos") ?? Y2.length;
      Y2.push({ pos: F, type: "r", node: b });
    }
    for (const $ of C(p.br)) {
      if (!$) continue;
      const b = typeof $ == "object" ? $ : {}, F = y(b, "__pos") ?? Y2.length;
      Y2.push({ pos: F, type: "br", node: b });
    }
    for (const $ of C(p.fld)) {
      if (!$ || typeof $ != "object") continue;
      const b = $, F = y(b, "__pos") ?? Y2.length;
      Y2.push({ pos: F, type: "fld", node: b });
    }
    Y2.sort(($, b) => $.pos - b.pos);
    for (const $ of Y2) {
      const b = $.node.t != null ? String($.node.t) : $.type === "br" ? `
` : "", F = $.node.rPr, I2 = Xn(F, n.themeColors, n.themeFonts, j);
      R.push({ text: b, properties: I2 });
    }
    if (R.length === 0) {
      const $ = p.endParaRPr, b = Xn($, n.themeColors, n.themeFonts, j);
      R.push({ text: "", properties: b });
    }
    x.push({ runs: R, properties: T });
  }
  return x.length === 0 && x.push({
    runs: [{
      text: "",
      properties: {
        fontFamily: ((c = n.themeFonts) == null ? void 0 : c.minorLatin) ?? "Calibri",
        fontSize: 18,
        bold: false,
        italic: false,
        underline: "none",
        strikethrough: false
      }
    }],
    properties: { alignment: "left", level: 0 }
  }), { paragraphs: x, bodyProperties: t };
}
function Ta(a) {
  if (!a || typeof a != "object") return;
  const n = a, m = n.off, t = n.ext;
  if (!m || !t) return;
  const o = y(m, "x"), l = y(m, "y"), s2 = y(t, "cx"), e = y(t, "cy");
  if (o === void 0 || l === void 0 || s2 === void 0 || e === void 0) return;
  const d2 = {
    position: { x: q(o), y: q(l) },
    size: { width: q(s2), height: q(e) }
  }, x = y(n, "rot");
  x !== void 0 && (d2.rotation = za(x));
  const g = w(n, "flipH");
  (g === "1" || g === "true") && (d2.flipH = true);
  const c = w(n, "flipV");
  return (c === "1" || c === "true") && (d2.flipV = true), d2;
}
function v0(a, n, m) {
  const t = a.prstGeom;
  if (t) {
    const l = w(t, "prst") ?? "rect", s2 = {}, e = t.avLst;
    if (e) {
      const x = C(e.gd);
      for (const g of x) {
        if (!g || typeof g != "object") continue;
        const c = g, r = w(c, "name"), p = w(c, "fmla");
        if (r && p) {
          const i = p.match(/^val\s+(\d+)$/);
          i && (s2[r] = parseInt(i[1], 10));
        }
      }
    }
    const d2 = { kind: "preset", preset: l };
    return Object.keys(s2).length > 0 && (d2.adjustValues = s2), d2;
  }
  const o = a.custGeom;
  if (o) {
    let l;
    return n && m && (l = u0(n, m)), l || (l = L0(o)), { kind: "custom", pathData: l };
  }
  return { kind: "preset", preset: "rect" };
}
function L0(a) {
  const n = a.pathLst;
  if (!n) return "";
  const m = C(n.path), t = [];
  for (const o of m) {
    if (!o || typeof o != "object") continue;
    const l = o, s2 = y(l, "w") ?? 1, e = y(l, "h") ?? 1, d2 = [];
    for (const x of C(l.moveTo)) {
      if (!x || typeof x != "object") continue;
      const g = x.pt;
      g && d2.push(`M${(y(g, "x") ?? 0) / s2},${(y(g, "y") ?? 0) / e}`);
    }
    for (const x of C(l.lnTo)) {
      if (!x || typeof x != "object") continue;
      const g = x.pt;
      g && d2.push(`L${(y(g, "x") ?? 0) / s2},${(y(g, "y") ?? 0) / e}`);
    }
    for (const x of C(l.cubicBezTo)) {
      if (!x || typeof x != "object") continue;
      const g = C(x.pt);
      if (g.length >= 3) {
        const c = g.map((r) => `${(y(r, "x") ?? 0) / s2},${(y(r, "y") ?? 0) / e}`);
        d2.push(`C${c[0]} ${c[1]} ${c[2]}`);
      }
    }
    for (const x of C(l.quadBezTo)) {
      if (!x || typeof x != "object") continue;
      const g = C(x.pt);
      if (g.length >= 2) {
        const c = g.map((r) => `${(y(r, "x") ?? 0) / s2},${(y(r, "y") ?? 0) / e}`);
        d2.push(`Q${c[0]} ${c[1]}`);
      }
    }
    for (const x of C(l.arcTo)) {
      if (!x || typeof x != "object") continue;
      const g = x, c = y(g, "wR") ?? 0, r = y(g, "hR") ?? 0, p = y(g, "stAng") ?? 0, i = y(g, "swAng") ?? 0, f = c / s2, h = r / e, L = Math.abs(i) > 180 * 6e4 ? 1 : 0, u = i > 0 ? 1 : 0, A = (p + i) / 6e4 * Math.PI / 180, T = f * Math.cos(A), j = h * Math.sin(A);
      d2.push(`A${f},${h} 0 ${L} ${u} ${T},${j}`);
    }
    l.close !== void 0 && d2.push("Z"), t.push(d2.join(" "));
  }
  return t.join(" ");
}
function u0(a, n) {
  const t = new RegExp(`cNvPr[^>]+id="${n}"`).exec(a);
  if (!t) return;
  const o = t.index, l = /<\/(?:p:)?sp>/g;
  l.lastIndex = o;
  const s2 = l.exec(a), e = s2 ? s2.index + s2[0].length : a.length, x = a.substring(o, e).match(/<(?:a:)?custGeom>([\s\S]*?)<\/(?:a:)?custGeom>/);
  if (x)
    return A0(x[0]);
}
function A0(a) {
  var o, l, s2, e;
  const n = [], m = /<(?:a:)?path\b([^>]*)>([\s\S]*?)<\/(?:a:)?path>/g;
  let t;
  for (; (t = m.exec(a)) !== null; ) {
    const d2 = t[1], x = t[2], g = d2.match(/w="(\d+)"/), c = d2.match(/h="(\d+)"/), r = g ? parseInt(g[1], 10) : 1, p = c ? parseInt(c[1], 10) : 1, i = [], f = /<(?:a:)?(moveTo|lnTo|cubicBezTo|quadBezTo|arcTo|close)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:a:)?\1>)/g;
    let h;
    for (; (h = f.exec(x)) !== null; ) {
      const L = h[1], u = h[2] || "", A = h[3] || "";
      switch (L) {
        case "moveTo": {
          const T = Fn(A);
          T && i.push(`M${T.x / r},${T.y / p}`);
          break;
        }
        case "lnTo": {
          const T = Fn(A);
          T && i.push(`L${T.x / r},${T.y / p}`);
          break;
        }
        case "cubicBezTo": {
          const T = Bn(A);
          T.length >= 3 && i.push(
            `C${T[0].x / r},${T[0].y / p} ${T[1].x / r},${T[1].y / p} ${T[2].x / r},${T[2].y / p}`
          );
          break;
        }
        case "quadBezTo": {
          const T = Bn(A);
          T.length >= 2 && i.push(`Q${T[0].x / r},${T[0].y / p} ${T[1].x / r},${T[1].y / p}`);
          break;
        }
        case "arcTo": {
          const T = parseFloat(((o = u.match(/wR="([^"]+)"/)) == null ? void 0 : o[1]) ?? "0"), j = parseFloat(((l = u.match(/hR="([^"]+)"/)) == null ? void 0 : l[1]) ?? "0"), R = parseFloat(((s2 = u.match(/stAng="([^"]+)"/)) == null ? void 0 : s2[1]) ?? "0"), Y2 = parseFloat(((e = u.match(/swAng="([^"]+)"/)) == null ? void 0 : e[1]) ?? "0"), $ = T / r, b = j / p, F = Math.abs(Y2) > 180 * 6e4 ? 1 : 0, I2 = Y2 > 0 ? 1 : 0, H = (R + Y2) / 6e4 * (Math.PI / 180), k = $ * Math.cos(H), X = b * Math.sin(H);
          i.push(`A${$},${b} 0 ${F} ${I2} ${k},${X}`);
          break;
        }
        case "close":
          i.push("Z");
          break;
      }
    }
    n.push(i.join(" "));
  }
  return n.join(" ");
}
function Fn(a) {
  const n = a.match(/<(?:a:)?pt\s+x="([^"]+)"\s+y="([^"]+)"/);
  return n ? { x: parseFloat(n[1]), y: parseFloat(n[2]) } : null;
}
function Bn(a) {
  const n = [], m = /<(?:a:)?pt\s+x="([^"]+)"\s+y="([^"]+)"/g;
  let t;
  for (; (t = m.exec(a)) !== null; )
    n.push({ x: parseFloat(t[1]), y: parseFloat(t[2]) });
  return n;
}
function Fa(a, n, m, t, o) {
  if (a.noFill !== void 0)
    return { type: "none" };
  if (a.grpFill !== void 0 && o)
    return o;
  const l = a.solidFill;
  if (l) {
    const x = z(l, n, m);
    if (x)
      return { type: "solid", color: x };
  }
  const s2 = a.gradFill;
  if (s2)
    return $0(s2, n, m);
  const e = a.pattFill;
  if (e) {
    const x = e["@_prst"], g = e.fgClr, c = e.bgClr, r = g ? z(g, n, m) : void 0, p = c ? z(c, n, m) : void 0;
    if (x && r)
      return {
        type: "pattern",
        preset: x,
        fgColor: r,
        bgColor: p ?? { hex: "#FFFFFF", alpha: 1 }
      };
  }
  const d2 = a.blipFill;
  if (d2 && (t != null && t.rels) && t.imageStore) {
    const x = d2.blip;
    if (x) {
      const g = x["@_r:embed"] ?? w(x, "embed");
      if (g) {
        const c = Ca(g, t.rels, t.basePath ?? "", t.imageStore);
        if (c) {
          const r = j0(d2.tile, c.dimensions), p = d2.stretch !== void 0, i = on(x), f = { type: "picture", src: c.src, stretch: p };
          return r && (f.tile = r), i !== void 0 && (f.alpha = i), f;
        }
      }
    }
  }
}
function b0(a, n, m, t) {
  const o = a._type;
  if (!o) return;
  const l = { [o]: a };
  return Fa(l, n, m, t);
}
function on(a) {
  if (!a || typeof a != "object") return;
  const n = a.alphaModFix;
  if (!n) return;
  const m = y(n, "amt");
  if (m === void 0) return;
  const t = m / 1e5;
  if (!(t >= 1))
    return Math.max(0, t);
}
function j0(a, n) {
  if (!a || typeof a != "object") return;
  const m = a, t = y(m, "sx"), o = y(m, "sy"), l = y(m, "tx"), s2 = y(m, "ty"), e = w(m, "algn"), d2 = w(m, "flip"), x = ["tl", "t", "tr", "l", "ctr", "r", "bl", "b", "br"], g = ["none", "x", "y", "xy"], c = x.includes(e ?? "") ? e : "tl", r = g.includes(d2 ?? "") ? d2 : "none", p = t !== void 0 ? t / 1e5 : 1, i = o !== void 0 ? o / 1e5 : 1, f = {
    scaleX: p,
    scaleY: i,
    offsetX: l !== void 0 ? q(l) : 0,
    offsetY: s2 !== void 0 ? q(s2) : 0,
    align: c,
    flip: r
  };
  return n && (f.tileWidth = n.width * 0.75 * p, f.tileHeight = n.height * 0.75 * i), f;
}
function $0(a, n, m) {
  const t = [];
  let o = 0, l = "linear";
  const s2 = a.gsLst;
  if (s2) {
    const r = C(s2.gs);
    for (const p of r) {
      if (!p || typeof p != "object") continue;
      const i = p, f = y(i, "pos"), h = z(i, n, m);
      f !== void 0 && h && t.push({
        position: V(f),
        color: h
      });
    }
  }
  t.sort((r, p) => r.position - p.position);
  const e = a.lin;
  if (e) {
    const r = y(e, "ang");
    r !== void 0 && (o = za(r));
  }
  let d2, x;
  const g = a.path;
  if (g) {
    l = "radial";
    const r = w(g, "path");
    (r === "circle" || r === "rect" || r === "shape") && (d2 = r);
    const p = g.fillToRect;
    if (p) {
      const i = y(p, "l"), f = y(p, "t"), h = y(p, "r"), L = y(p, "b");
      x = {
        left: i !== void 0 ? i / 1e5 : 0,
        top: f !== void 0 ? f / 1e5 : 0,
        right: h !== void 0 ? h / 1e5 : 0,
        bottom: L !== void 0 ? L / 1e5 : 0
      };
    }
  }
  const c = {
    type: "gradient",
    gradientType: l,
    angle: o,
    stops: t
  };
  return d2 && (c.path = d2), x && (c.fillToRect = x), c;
}
function Ja(a, n, m) {
  if (!a || typeof a != "object") return;
  const t = a, o = y(t, "w");
  if (o === void 0 && !t.solidFill && !t.noFill || t.noFill !== void 0) return;
  let l = { hex: "#000000", alpha: 1 };
  const s2 = t.solidFill;
  if (s2) {
    const p = z(s2, n, m);
    p && (l = p);
  }
  let e = "solid";
  const d2 = t.prstDash;
  if (d2) {
    const p = w(d2, "val");
    switch (p) {
      case "solid":
      case "dot":
      case "dash":
      case "lgDash":
      case "dashDot":
      case "lgDashDot":
      case "lgDashDotDot":
      case "sysDash":
      case "sysDot":
      case "sysDashDot":
      case "sysDashDotDot":
        e = p;
        break;
    }
  }
  let x = "round";
  t.round !== void 0 ? x = "round" : t.bevel !== void 0 ? x = "bevel" : t.miter !== void 0 && (x = "miter");
  const g = kn(t.headEnd), c = kn(t.tailEnd), r = {
    width: o !== void 0 ? q(o) : 1,
    color: l,
    dashStyle: e,
    lineJoin: x
  };
  return g && (r.headEnd = g), c && (r.tailEnd = c), r;
}
function kn(a) {
  if (!a || typeof a != "object") return;
  const n = a, m = w(n, "type");
  if (!m || m === "none") return;
  const t = {
    triangle: "triangle",
    stealth: "stealth",
    oval: "oval",
    diamond: "diamond",
    arrow: "arrow"
  }, o = {
    sm: "small",
    med: "medium",
    lg: "large"
  };
  return {
    type: t[m] ?? "triangle",
    width: o[w(n, "w") ?? "med"] ?? "medium",
    length: o[w(n, "len") ?? "med"] ?? "medium"
  };
}
function ln(a, n) {
  const m = a.effectLst;
  if (!m) return;
  const t = m.outerShdw;
  if (!t) return;
  const o = y(t, "blurRad"), l = o !== void 0 ? q(o) : 4, s2 = y(t, "dist") ?? 0, e = y(t, "dir") ?? 0, d2 = za(e) * (Math.PI / 180), x = q(s2), g = x * Math.cos(d2), c = x * Math.sin(d2), r = y(t, "sx"), p = y(t, "sy"), i = r !== void 0 ? r / 1e5 : void 0, f = p !== void 0 ? p / 1e5 : void 0, h = w(t, "algn") ?? void 0;
  return { color: z(t, n) ?? { hex: "#000000", alpha: 0.4 }, blurRadius: l, offsetX: g, offsetY: c, scaleX: i, scaleY: f, align: h };
}
function R0(a, n = {}) {
  if (!a || typeof a != "object") return;
  const m = a, t = m.nvSpPr, o = t == null ? void 0 : t.cNvPr, l = w(o ?? {}, "id") ?? "0", s2 = m.spPr, e = s2 && typeof s2 == "object" ? s2 : void 0;
  if (!e) {
    const b = Ka(m.txBody, n), F = {
      type: "shape",
      id: l,
      position: { x: 0, y: 0 },
      size: { width: 0, height: 0 },
      geometry: { kind: "preset", preset: "rect" }
    };
    return b && (F.textBody = b), F;
  }
  const d2 = Ta(e.xfrm), x = (d2 == null ? void 0 : d2.position) ?? { x: 0, y: 0 }, g = (d2 == null ? void 0 : d2.size) ?? { width: 0, height: 0 }, c = d2 != null && d2.rotation || d2 != null && d2.flipH || d2 != null && d2.flipV ? {
    rotation: d2 == null ? void 0 : d2.rotation,
    flipH: d2 == null ? void 0 : d2.flipH,
    flipV: d2 == null ? void 0 : d2.flipV
  } : void 0, r = v0(e, n.rawXml, l), p = m.style, i = p == null ? void 0 : p.fillRef;
  let f;
  if (i) {
    const b = z(i, n.themeColors);
    b && (f = b.hex);
  }
  const h = { rels: n.rels, basePath: n.basePath, imageStore: n.imageStore };
  let L = Fa(e, n.themeColors, f, h, n.groupFill);
  if (!L && i) {
    const b = y(i, "idx");
    if (b && b >= 1 && b <= 3 && n.fillStyles) {
      const F = n.fillStyles[b - 1];
      if (F) {
        const I2 = b0(F, n.themeColors, f, h);
        I2 && (L = I2);
      }
    }
    if (!L && b && b > 0) {
      const F = f ? { hex: f, alpha: 1 } : z(i, n.themeColors) ?? void 0;
      F && (L = { type: "solid", color: { hex: F.hex, alpha: F.alpha ?? 1 } });
    }
  }
  const u = p == null ? void 0 : p.lnRef;
  let A;
  if (u) {
    const b = z(u, n.themeColors);
    b && (A = b.hex);
  }
  const T = e.ln !== void 0;
  let j = Ja(e.ln, n.themeColors, A);
  if (!j && !T && A && u) {
    const b = y(u, "idx");
    if (b && b >= 1 && b <= 3 && n.lnStyles) {
      const F = n.lnStyles[b - 1], I2 = Ja(F, n.themeColors, A);
      I2 && (j = I2);
    }
    !j && b && b > 0 && (j = { width: 1, color: { hex: A, alpha: 1 }, dashStyle: "solid", lineJoin: "round" });
  }
  const R = ln(e, n.themeColors), Y2 = Ka(m.txBody, n);
  if (Y2) {
    const b = p == null ? void 0 : p.fontRef;
    if (b) {
      const F = z(b, n.themeColors);
      if (F)
        for (const I2 of Y2.paragraphs)
          for (const H of I2.runs)
            H.properties.color || (H.properties.color = {
              hex: F.hex,
              alpha: F.alpha ?? 1
            });
    }
  }
  const $ = {
    type: "shape",
    id: l,
    position: x,
    size: g,
    geometry: r
  };
  return c && ($.transform = c), L && ($.fill = L), j && ($.stroke = j), R && ($.shadow = R), Y2 && ($.textBody = Y2), $;
}
var Y0 = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  processEntities: true,
  htmlEntities: true
});
var X0 = [
  "wholeTbl",
  "band1H",
  "band2H",
  "band1V",
  "band2V",
  "firstRow",
  "lastRow",
  "firstCol",
  "lastCol",
  "nwCell",
  "neCell",
  "swCell",
  "seCell"
];
function qn(a) {
  const n = /* @__PURE__ */ new Map(), m = Y0.parse(a), t = m == null ? void 0 : m.tblStyleLst;
  if (!t) return n;
  const o = t.tblStyle, l = Array.isArray(o) ? o : o ? [o] : [];
  for (const s2 of l) {
    if (!s2 || typeof s2 != "object") continue;
    const e = s2, d2 = e["@_styleId"];
    if (!d2) continue;
    const x = {};
    for (const g of X0) {
      const c = e[g];
      c && typeof c == "object" && (x[g] = c);
    }
    n.set(d2, x);
  }
  return n;
}
function C0(a, n, m, t, o, l) {
  const s2 = [];
  a.wholeTbl && s2.push(a.wholeTbl);
  const e = n.firstRow && m === 0, d2 = n.lastRow && m === o - 1, x = n.firstCol && t === 0, g = n.lastCol && t === l - 1;
  if (n.bandCol && !x && !g) {
    const c = t - (n.firstCol ? 1 : 0);
    if (c >= 0) {
      const r = c % 2 === 0 ? a.band1V : a.band2V;
      r && s2.push(r);
    }
  }
  if (n.bandRow && !e && !d2) {
    const c = m - (n.firstRow ? 1 : 0);
    if (c >= 0) {
      const r = c % 2 === 0 ? a.band1H : a.band2H;
      r && s2.push(r);
    }
  }
  return x && a.firstCol && s2.push(a.firstCol), g && a.lastCol && s2.push(a.lastCol), e && a.firstRow && s2.push(a.firstRow), d2 && a.lastRow && s2.push(a.lastRow), e && x && a.nwCell && s2.push(a.nwCell), e && g && a.neCell && s2.push(a.neCell), d2 && x && a.swCell && s2.push(a.swCell), d2 && g && a.seCell && s2.push(a.seCell), s2;
}
function F0(a, n, m) {
  const t = a.tcTxStyle;
  if (!t) return {};
  const o = {}, l = m(t, n);
  l && (o.color = l);
  const s2 = t["@_b"];
  (s2 === "on" || s2 === "1" || s2 === "true") && (o.bold = true);
  const e = t["@_i"];
  return (e === "on" || e === "1" || e === "true") && (o.italic = true), o;
}
function ja(a, n) {
  if (!a || typeof a != "object") return;
  const m = a;
  if (m.noFill !== void 0) return;
  const t = y(m, "w");
  if (t === 0) return;
  const o = m.solidFill;
  if (!o && t === void 0) return;
  const l = t !== void 0 ? q(t) : 1;
  let s2 = { hex: "#000000", alpha: 1 };
  if (o) {
    const x = z(o, n);
    x && (s2 = x);
  }
  let e = "solid";
  const d2 = m.prstDash;
  if (d2)
    switch (w(d2, "val")) {
      case "dash":
      case "lgDash":
      case "sysDash":
      case "dashDot":
      case "lgDashDot":
      case "lgDashDotDot":
      case "sysDashDot":
      case "sysDashDotDot":
        e = "dashed";
        break;
      case "dot":
      case "sysDot":
        e = "dotted";
        break;
    }
  return { width: l, color: s2, style: e };
}
function B0(a, n) {
  const m = {};
  let t = false;
  const o = ja(a.lnT, n);
  o && (m.top = o, t = true);
  const l = ja(a.lnR, n);
  l && (m.right = l, t = true);
  const s2 = ja(a.lnB, n);
  s2 && (m.bottom = s2, t = true);
  const e = ja(a.lnL, n);
  return e && (m.left = e, t = true), t ? m : void 0;
}
function k0(a, n) {
  const m = {
    colSpan: 1,
    rowSpan: 1
  };
  if (!a || typeof a != "object") return m;
  const t = a, o = y(t, "gridSpan");
  o !== void 0 && o > 1 && (m.colSpan = o);
  const l = y(t, "rowSpan");
  l !== void 0 && l > 1 && (m.rowSpan = l);
  const s2 = w(t, "hMerge");
  if (s2 === "1" || s2 === "true")
    return m.isMerged = true, m;
  const e = w(t, "vMerge");
  if (e === "1" || e === "true")
    return m.isMerged = true, m;
  const d2 = t.txBody;
  d2 && (m.textBody = Ka(d2, n));
  const x = t.tcPr;
  if (x) {
    const g = Fa(x, n.themeColors);
    g && (m.fill = g);
    const c = B0(x, n.themeColors);
    c && (m.borders = c);
  }
  return m;
}
function q0(a, n) {
  const m = {};
  for (const t of a) {
    const o = t.tcStyle;
    if (o) {
      const s2 = o.fill;
      if (s2) {
        const d2 = Fa(s2, n.themeColors);
        d2 && (m.fill = d2);
      }
      const e = o.tcBdr;
      if (e) {
        const d2 = m.borders ?? {}, x = [
          ["top", "top"],
          ["right", "right"],
          ["bottom", "bottom"],
          ["left", "left"]
        ];
        for (const [g, c] of x) {
          const r = e[c];
          if (!r) continue;
          const p = r.ln;
          if (!p) continue;
          const i = ja(p, n.themeColors);
          i && (d2[g] = i);
        }
        Object.keys(d2).length > 0 && (m.borders = d2);
      }
    }
    const l = F0(t, n.themeColors, z);
    l.color && (m.textColor = l.color), l.bold && (m.textBold = true), l.italic && (m.textItalic = true);
  }
  return m;
}
function M0(a, n = {}) {
  var I2;
  if (!a || typeof a != "object") return;
  const m = a, t = m.nvGraphicFramePr, o = t == null ? void 0 : t.cNvPr, l = w(o ?? {}, "id") ?? "0", s2 = m.xfrm, e = Ta(s2), d2 = (e == null ? void 0 : e.position) ?? { x: 0, y: 0 }, x = (e == null ? void 0 : e.size) ?? { width: 0, height: 0 }, g = m.graphic;
  if (!g) return;
  const c = g.graphicData;
  if (!c) return;
  const r = c.tbl;
  if (!r) return;
  const p = r.tblPr, i = {
    firstRow: w(p ?? {}, "firstRow") === "1",
    lastRow: w(p ?? {}, "lastRow") === "1",
    firstCol: w(p ?? {}, "firstCol") === "1",
    lastCol: w(p ?? {}, "lastCol") === "1",
    bandRow: w(p ?? {}, "bandRow") === "1",
    bandCol: w(p ?? {}, "bandCol") === "1"
  }, f = (I2 = n.themeColors) == null ? void 0 : I2.accent1;
  let h;
  const L = p == null ? void 0 : p.tableStyleId;
  if (L && n.tableStyles) {
    const H = typeof L == "string" ? L : L["#text"];
    H && (h = n.tableStyles.get(H));
  }
  const u = r.tblGrid, A = [];
  if (u) {
    const H = C(u.gridCol);
    for (const k of H) {
      if (!k || typeof k != "object") continue;
      const X = y(k, "w");
      A.push(X !== void 0 ? q(X) : 0);
    }
  }
  const T = C(r.tr), j = T.length, R = A.length, Y2 = [], $ = [];
  for (let H = 0; H < T.length; H++) {
    const k = T[H];
    if (!k || typeof k != "object") continue;
    const X = k, B = y(X, "h");
    $.push(B !== void 0 ? q(B) : 0);
    const S2 = C(X.tc), _ = [];
    for (let Z = 0; Z < S2.length; Z++) {
      const M = k0(S2[Z], n);
      if (h) {
        const aa = C0(h, i, H, Z, j, R);
        if (aa.length > 0) {
          const D = q0(aa, n);
          if (D.fill && !M.fill && (M.fill = D.fill), D.borders) {
            const J2 = { ...D.borders, ...M.borders ?? {} };
            M.borders = J2;
          }
          D.textColor && M.textBody && P0(M.textBody, D.textColor, D.textBold, D.textItalic);
        }
      }
      _.push(M);
    }
    Y2.push({ cells: _ });
  }
  const b = { colWidths: A, rowHeights: $ }, F = i.firstRow || i.bandRow ? { firstRow: i.firstRow || void 0, bandRow: i.bandRow || void 0, accentColor: f } : void 0;
  return {
    type: "table",
    id: l,
    position: d2,
    size: x,
    grid: b,
    rows: Y2,
    tableStyle: F
  };
}
function P0(a, n, m, t) {
  for (const o of a.paragraphs)
    for (const l of o.runs)
      n && !l.properties.color && (l.properties.color = n), m && l.properties.bold === void 0 && (l.properties.bold = true), t && l.properties.italic === void 0 && (l.properties.italic = true);
}
var S0 = {
  dk1: "dk1",
  dk2: "dk2",
  lt1: "lt1",
  lt2: "lt2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hlink: "hlink",
  folHlink: "folHlink",
  bg1: "lt1",
  bg2: "lt2",
  tx1: "dk1",
  tx2: "dk2"
};
function O0(a, n) {
  if (!n) return;
  const m = S0[a];
  return m ? n[m] : void 0;
}
function I0(a, n, m) {
  if (n === void 0 && m === void 0) return a;
  const t = parseInt(a.slice(1, 3), 16) / 255, o = parseInt(a.slice(3, 5), 16) / 255, l = parseInt(a.slice(5, 7), 16) / 255, s2 = Math.max(t, o, l), e = Math.min(t, o, l);
  let d2 = 0, x = 0, g = (s2 + e) / 2;
  if (s2 !== e) {
    const u = s2 - e;
    x = g > 0.5 ? u / (2 - s2 - e) : u / (s2 + e), s2 === t ? d2 = ((o - l) / u + (o < l ? 6 : 0)) / 6 : s2 === o ? d2 = ((l - t) / u + 2) / 6 : d2 = ((t - o) / u + 4) / 6;
  }
  const c = n !== void 0 ? n / 1e5 : 1, r = m !== void 0 ? m / 1e5 : 0;
  g = Math.min(1, Math.max(0, g * c + r));
  const p = (u, A, T) => (T < 0 && (T += 1), T > 1 && (T -= 1), T < 1 / 6 ? u + (A - u) * 6 * T : T < 1 / 2 ? A : T < 2 / 3 ? u + (A - u) * (2 / 3 - T) * 6 : u);
  let i, f, h;
  if (x === 0)
    i = f = h = g;
  else {
    const u = g < 0.5 ? g * (1 + x) : g + x - g * x, A = 2 * g - u;
    i = p(A, u, d2 + 1 / 3), f = p(A, u, d2), h = p(A, u, d2 - 1 / 3);
  }
  const L = (u) => Math.round(u * 255).toString(16).padStart(2, "0");
  return `#${L(i)}${L(f)}${L(h)}`;
}
function ia(a, n) {
  const m = a.match(/<a:schemeClr\s+val="([^"]+)"\s*(\/?>[\s\S]*?<\/a:schemeClr>|\/>)/);
  if (m) {
    let o = O0(m[1], n);
    if (o) {
      const l = m[2], s2 = l.match(/<a:lumMod\s+val="(\d+)"/), e = l.match(/<a:lumOff\s+val="(\d+)"/);
      return o = I0(
        o,
        s2 ? parseInt(s2[1], 10) : void 0,
        e ? parseInt(e[1], 10) : void 0
      ), o;
    }
  }
  const t = a.match(/<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/);
  if (t) return `#${t[1]}`;
}
function D0(a) {
  const n = a.match(/<a:ln(?:\s[^>]*)?\s+w="(\d+)"/);
  if (n)
    return parseInt(n[1], 10);
}
function sn(a, n) {
  const m = a.match(/<a:defRPr[\s\S]*?<\/a:defRPr>/), t = m ? m[0] : a;
  return ia(t, n);
}
function en(a) {
  const n = a.match(/<a:defRPr[^>]*\ssz="(\d+)"/);
  if (n)
    return parseInt(n[1], 10) / 100;
}
function E0(a) {
  return a.match(/<a:defRPr[^>]*\sb="1"/) ? true : void 0;
}
function Mn(a, n) {
  const m = /<c:showVal\s+val="1"/.test(a), t = /<c:showCatName\s+val="1"/.test(a), o = /<c:showPercent\s+val="1"/.test(a), l = /<c:showSerName\s+val="1"/.test(a);
  if (!m && !t && !o && !l) return;
  const s2 = a.match(/<c:dLblPos\s+val="([^"]+)"/), e = a.match(/<c:numFmt\s+formatCode="([^"]*)"/), d2 = a.match(/<c:txPr>([\s\S]*?)<\/c:txPr>/), x = d2 ? d2[1] : "";
  return {
    showValue: m,
    showCategory: t,
    showPercent: o,
    showSeriesName: l,
    position: s2 == null ? void 0 : s2[1],
    color: x ? sn(x, n) : void 0,
    fontSize: x ? en(x) : void 0,
    bold: x ? E0(x) : void 0,
    numFmt: e == null ? void 0 : e[1]
  };
}
function Pn(a, n) {
  const m = /<c:delete\s+val="1"/.test(a), o = a.replace(/<c:majorGridlines>[\s\S]*?<\/c:majorGridlines>/, "").match(/<c:spPr>([\s\S]*?)<\/c:spPr>/), l = o ? ia(o[1], n) : void 0;
  let s2;
  const e = a.match(/<c:majorGridlines>([\s\S]*?)<\/c:majorGridlines>/);
  if (e) {
    const f = e[1].match(/<c:spPr>([\s\S]*?)<\/c:spPr>/);
    s2 = f ? ia(f[1], n) : "#d9d9d9";
  }
  const d2 = a.match(/<c:txPr>([\s\S]*?)<\/c:txPr>/), x = d2 ? d2[1] : "", g = x ? sn(x, n) : void 0, c = x ? en(x) : void 0, r = a.match(/<c:min\s+val="([-\d.]+)"/), p = a.match(/<c:max\s+val="([-\d.]+)"/), i = a.match(/<c:numFmt\s+formatCode="([^"]*)"/);
  return {
    hidden: m,
    lineColor: l,
    gridColor: s2,
    labelColor: g,
    labelFontSize: c,
    min: r ? parseFloat(r[1]) : void 0,
    max: p ? parseFloat(p[1]) : void 0,
    numFmt: i == null ? void 0 : i[1]
  };
}
function z0(a, n) {
  const m = a.match(/<c:legendPos\s+val="([^"]+)"/), t = a.match(/<c:txPr>([\s\S]*?)<\/c:txPr>/), o = t ? t[1] : "";
  return {
    position: (m == null ? void 0 : m[1]) ?? "r",
    color: o ? sn(o, n) : void 0,
    fontSize: o ? en(o) : void 0
  };
}
function Sn(a) {
  const n = a.match(/<c:strCache>([\s\S]*?)<\/c:strCache>/);
  if (!n) return [];
  const m = [], t = /<c:pt\s+idx="(\d+)">\s*<c:v>([^<]*)<\/c:v>/g;
  let o;
  for (; (o = t.exec(n[1])) !== null; )
    m[parseInt(o[1], 10)] = o[2];
  return m;
}
function G0(a) {
  const n = a.match(/<c:numCache>([\s\S]*?)<\/c:numCache>/);
  if (!n) return [];
  const m = [], t = /<c:pt\s+idx="(\d+)">\s*<c:v>([^<]+)<\/c:v>/g;
  let o;
  for (; (o = t.exec(n[1])) !== null; )
    m[parseInt(o[1], 10)] = parseFloat(o[2]);
  return m;
}
function H0(a, n, m = false) {
  let t = a.replace(/<c:dPt>[\s\S]*?<\/c:dPt>/g, "");
  t = t.replace(/<c:dLbls>[\s\S]*?<\/c:dLbls>/g, "");
  const o = t.match(/<c:spPr>([\s\S]*?)<\/c:spPr>/);
  if (!o) return {};
  const l = o[1], s2 = l.match(/<a:ln[\s\S]*?<\/a:ln>/);
  let e, d2;
  s2 && (e = ia(s2[0], n), d2 = D0(s2[0]));
  const x = l.replace(/<a:ln[\s\S]*?<\/a:ln>/g, ""), g = ia(x, n);
  return m ? { fillColor: e, lineColor: e, lineWidthEmu: d2 } : { fillColor: g, lineColor: e, lineWidthEmu: d2 };
}
function N0(a, n) {
  const m = /* @__PURE__ */ new Map(), t = /<c:dPt>([\s\S]*?)<\/c:dPt>/g;
  let o;
  for (; (o = t.exec(a)) !== null; ) {
    const l = o[1], s2 = l.match(/<c:idx\s+val="(\d+)"/);
    if (!s2) continue;
    const e = parseInt(s2[1], 10), d2 = l.match(/<c:spPr>([\s\S]*?)<\/c:spPr>/);
    if (d2) {
      const x = d2[1].replace(/<a:ln[\s\S]*?<\/a:ln>/g, ""), g = ia(x, n) ?? ia(d2[1], n);
      g && m.set(e, g);
    }
  }
  return m;
}
function Z0(a) {
  if (/<c:doughnutChart/.test(a)) return { type: "doughnut", plotTag: "doughnutChart" };
  if (/<c:pieChart/.test(a)) return { type: "pie", plotTag: "pieChart" };
  if (/<c:barChart/.test(a)) {
    const n = a.match(/<c:barDir\s+val="(col|bar)"/);
    return { type: ((n == null ? void 0 : n[1]) ?? "col") === "bar" ? "barBar" : "barCol", plotTag: "barChart" };
  }
  if (/<c:lineChart/.test(a)) return { type: "line", plotTag: "lineChart" };
}
function _0(a, n) {
  const m = Z0(a);
  if (!m) return;
  const { type: t, plotTag: o } = m, l = t === "pie" || t === "doughnut", s2 = t === "line", e = new RegExp(`<c:${o}>([\\s\\S]*?)<\\/c:${o}>`), d2 = a.match(e), x = d2 ? d2[1] : a;
  let g = 0;
  if (t === "doughnut") {
    const k = x.match(/<c:holeSize\s+val="(\d+)"/);
    k && (g = parseInt(k[1], 10));
  }
  let c = 0;
  const r = x.match(/<c:firstSliceAng\s+val="(\d+)"/);
  r && (c = parseInt(r[1], 10));
  let p, i, f;
  if (t === "barCol" || t === "barBar") {
    const k = x.match(/<c:grouping\s+val="([^"]+)"/);
    p = (k == null ? void 0 : k[1]) ?? "clustered";
    const X = x.match(/<c:gapWidth\s+val="(-?\d+)"/);
    X && (i = parseInt(X[1], 10));
    const B = x.match(/<c:overlap\s+val="(-?\d+)"/);
    B && (f = parseInt(B[1], 10));
  }
  const h = [], L = /<c:ser>([\s\S]*?)<\/c:ser>/g;
  let u;
  for (; (u = L.exec(x)) !== null; )
    h.push(u[1]);
  if (h.length === 0) return;
  let A = [];
  for (const k of h) {
    const X = k.match(/<c:cat>([\s\S]*?)<\/c:cat>/);
    if (X) {
      const B = Sn(X[1]);
      if (B.length > 0) {
        A = B;
        break;
      }
    }
  }
  const T = [], j = [];
  for (const k of h) {
    const X = k.match(/<c:tx>([\s\S]*?)<\/c:tx>/), B = X ? Sn(X[1])[0] : void 0, S2 = k.match(/<c:val>([\s\S]*?)<\/c:val>/), _ = S2 ? G0(S2[1]) : [];
    if (_.length === 0) continue;
    const { fillColor: Z, lineColor: M, lineWidthEmu: aa } = H0(k, n, s2), D = N0(k, n), J2 = [];
    for (let na = 0; na < _.length; na++) {
      const oa = _[na];
      oa !== void 0 && J2.push({
        value: oa,
        color: D.get(na)
      });
    }
    T.push({
      name: B,
      color: Z,
      lineColor: M,
      lineWidth: aa ? aa / 12700 : void 0,
      // EMU → pt (1pt = 12700 EMU)
      dataPoints: J2
    });
    const O = k.match(/<c:dLbls>([\s\S]*?)<\/c:dLbls>/);
    j.push(O ? Mn(O[1], n) : void 0);
  }
  if (T.length === 0) return;
  const Y2 = x.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, "").match(/<c:dLbls>([\s\S]*?)<\/c:dLbls>/), $ = Y2 ? Mn(Y2[1], n) : void 0;
  let b, F;
  if (!l) {
    const k = a.match(/<c:catAx>([\s\S]*?)<\/c:catAx>/);
    k && (b = Pn(k[1], n));
    const X = a.match(/<c:valAx>([\s\S]*?)<\/c:valAx>/);
    X && (F = Pn(X[1], n));
  }
  let I2;
  const H = a.match(/<c:legend>([\s\S]*?)<\/c:legend>/);
  return H && (I2 = z0(H[1], n)), {
    chartType: t,
    categories: A,
    series: T,
    holeSize: g,
    firstSliceAngle: c,
    barGrouping: p,
    gapWidth: i,
    overlap: f,
    dataLabels: $,
    seriesDataLabels: j,
    categoryAxis: b,
    valueAxis: F,
    legend: I2
  };
}
var V0 = {
  fade: "fade",
  push: "push",
  wipe: "wipe",
  split: "split",
  cover: "cover",
  pull: "cover",
  // <p:pull> is "uncover" in OOXML terminology
  cut: "cut",
  blinds: "fade",
  // approximate unsupported types
  checker: "fade",
  circle: "fade",
  dissolve: "fade",
  plus: "fade",
  random: "fade",
  randomBar: "fade",
  strips: "fade",
  wedge: "fade",
  wheel: "fade",
  newsflash: "fade",
  zoom: "fade"
};
var W0 = {
  slow: 1e3,
  med: 750,
  fast: 500
};
function Q0(a) {
  if (a.transition) return a.transition;
  const n = a.AlternateContent;
  if (n) {
    const m = Array.isArray(n) ? n : [n];
    for (const t of m) {
      const o = t, l = o.Fallback;
      if (l != null && l.transition) return l.transition;
      const s2 = o.Choice;
      if (s2 != null && s2.transition) return s2.transition;
    }
  }
}
function U0(a) {
  for (const [n, m] of Object.entries(V0))
    if (a[n] !== void 0) {
      const t = a[n], o = typeof t == "object" ? w(t, "dir") : void 0;
      return { type: m, direction: o };
    }
  return { type: "none" };
}
function K0(a) {
  const n = Q0(a);
  if (!n) return;
  const { type: m, direction: t } = U0(n), o = y(n, "dur"), l = w(n, "spd"), s2 = o ?? (l ? W0[l] ?? 750 : 750), d2 = w(n, "advClick") !== "0", x = y(n, "advTm"), g = { type: m, duration: s2 };
  return (t === "l" || t === "r" || t === "u" || t === "d") && (g.direction = t), d2 || (g.advanceOnClick = false), x !== void 0 && (g.advanceAfter = x), g;
}
var J0 = [
  { id: 1, name: "appear", defaultDuration: 1 },
  {
    id: 2,
    name: "fly-in",
    defaultDuration: 500,
    subtypeDirections: {
      0: "bottom",
      2: "right",
      4: "top",
      6: "left",
      8: "left-bottom",
      9: "left-top",
      3: "right-bottom",
      5: "right-top"
    }
  },
  { id: 10, name: "fade", defaultDuration: 500 },
  {
    id: 12,
    name: "peek-in",
    defaultDuration: 500,
    subtypeDirections: { 0: "bottom", 2: "right", 4: "top", 6: "left", 8: "left" }
  },
  {
    id: 16,
    name: "split",
    defaultDuration: 500,
    subtypeDirections: {
      16: "horizontal-out",
      17: "horizontal-in",
      18: "vertical-out",
      19: "vertical-in"
    }
  },
  {
    id: 22,
    name: "wipe",
    defaultDuration: 500,
    subtypeDirections: { 0: "top", 2: "left", 4: "bottom", 6: "right", 8: "left" }
  },
  {
    id: 26,
    name: "fly-in",
    defaultDuration: 1e3,
    subtypeDirections: {
      0: "bottom",
      2: "right",
      4: "top",
      6: "left",
      8: "left-bottom",
      9: "left-top",
      3: "right-bottom",
      5: "right-top"
    }
  },
  { id: 42, name: "float-in", defaultDuration: 1e3 },
  { id: 47, name: "fade", defaultDuration: 500 },
  // Dissolve In
  { id: 49, name: "swivel", defaultDuration: 500 },
  { id: 53, name: "zoom", defaultDuration: 500 }
];
function ax(a) {
  const n = /* @__PURE__ */ new Map();
  for (const m of a)
    n.set(m.id, {
      name: m.name,
      subtypeDirections: m.subtypeDirections,
      defaultDuration: m.defaultDuration ?? 500
    });
  return n;
}
var nx = ax(J0);
var mx = {
  entr: "entrance",
  exit: "exit",
  emph: "emphasis",
  path: "path"
};
var tx = {
  clickEffect: "onClick",
  withEffect: "withPrevious",
  afterEffect: "afterPrevious"
};
function ox(a, n, m) {
  var s2;
  const o = nx.get(a);
  if (!o) return;
  const l = m !== void 0 ? (s2 = o.subtypeDirections) == null ? void 0 : s2[m] : void 0;
  return {
    name: o.name,
    direction: l,
    defaultDuration: o.defaultDuration
  };
}
function lx(a) {
  const n = a.tnLst;
  if (!n) return;
  const m = C(n.par);
  for (const t of m) {
    const o = t.cTn;
    if (!o) continue;
    const l = o.childTnLst;
    if (!l) continue;
    const s2 = C(l.seq);
    for (const e of s2) {
      const d2 = e.cTn;
      if (d2 && w(d2, "nodeType") === "mainSeq")
        return d2;
    }
  }
}
function sx(a) {
  const n = a.childTnLst;
  return n ? C(n.par) : [];
}
function Un(a) {
  const n = [], m = a.cTn;
  if (m) {
    if (w(m, "presetID"))
      return n.push(m), n;
    const t = m.childTnLst;
    if (t)
      for (const o of C(t.par))
        n.push(...Un(o));
  }
  return n;
}
function Kn(a) {
  const n = a.childTnLst;
  if (!n) return;
  const m = ["set", "animEffect", "anim"];
  for (const t of m)
    for (const o of C(n[t])) {
      const l = o.cBhvr;
      if (l) {
        const s2 = l.tgtEl;
        if (s2) {
          const e = s2.spTgt;
          if (e && w(e, "spid")) return e;
        }
      }
    }
}
function ex(a) {
  const n = Kn(a);
  return n ? w(n, "spid") : void 0;
}
function dx(a) {
  const n = Kn(a);
  if (!n) return;
  const m = n.txEl;
  if (!m) return;
  const t = m.pRg;
  if (t)
    return y(t, "st");
}
function xx(a, n) {
  const m = y(a, "dur");
  if (m && m > 0 && m !== 1 / 0) return m;
  const t = a.childTnLst;
  if (!t) return n;
  for (const o of C(t.animEffect)) {
    const l = o.cBhvr;
    if (l) {
      const s2 = l.cTn;
      if (s2) {
        const e = y(s2, "dur");
        if (e && e > 0) return e;
      }
    }
  }
  for (const o of C(t.anim)) {
    const l = o.cBhvr;
    if (l) {
      const s2 = l.cTn;
      if (s2) {
        const e = y(s2, "dur");
        if (e && e > 0) return e;
      }
    }
  }
  return n;
}
function gx(a) {
  const n = a.stCondLst;
  if (!n) return;
  const m = C(n.cond);
  for (const t of m) {
    const o = y(t, "delay");
    if (o !== void 0 && o > 0) return o;
  }
}
function cx(a) {
  const n = w(a, "presetID");
  if (!n) return;
  const m = Number(n), t = w(a, "presetClass") ?? "entr", o = mx[t] ?? "entrance";
  if (o !== "entrance" && o !== "exit") return;
  const l = y(a, "presetSubtype"), s2 = ox(m, o, l), e = ex(a);
  if (!e) return;
  const d2 = w(a, "nodeType") ?? "clickEffect", x = dx(a);
  return {
    targetId: e,
    paragraphIndex: x,
    preset: (s2 == null ? void 0 : s2.name) ?? "fade",
    animClass: o,
    trigger: tx[d2] ?? "onClick",
    duration: xx(a, (s2 == null ? void 0 : s2.defaultDuration) ?? 500),
    delay: gx(a),
    direction: s2 == null ? void 0 : s2.direction,
    presetSubtype: l
  };
}
function rx(a) {
  const n = a.timing;
  if (!n) return;
  const m = lx(n);
  if (!m) return;
  const t = sx(m);
  if (t.length === 0) return;
  const o = [], l = [], s2 = [], e = /* @__PURE__ */ new Set(), d2 = /* @__PURE__ */ new Set();
  for (const x of t) {
    const g = Un(x), c = [];
    for (const r of g) {
      const p = cx(r);
      p && c.push(p);
    }
    if (c.length > 0) {
      o.push({ effects: c });
      for (const r of c) {
        const p = r.paragraphIndex !== void 0 ? `${r.targetId}:p${r.paragraphIndex}` : r.targetId;
        r.animClass === "entrance" && !e.has(p) && (l.push(p), e.add(p)), r.animClass === "exit" && !d2.has(p) && (s2.push(p), d2.add(p));
      }
    }
  }
  if (o.length !== 0)
    return { hiddenShapeIds: l, exitShapeIds: s2, steps: o };
}
function dn(a) {
  let n = 0;
  return a.replace(/<a:(r|br|fld)(?=[\s/>])/g, (m) => `${m} __pos="${n++}"`);
}
var xn = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  processEntities: true,
  htmlEntities: true,
  isArray: (a) => [
    "sp",
    "pic",
    "grpSp",
    "graphicFrame",
    "cxnSp",
    "p",
    "r",
    "br",
    "tr",
    "tc",
    "gs",
    "gd",
    "path",
    "Relationship",
    "par",
    "seq",
    "set",
    "anim",
    "animEffect",
    "tav"
  ].includes(a)
});
function gn(a) {
  const n = [], m = /* @__PURE__ */ new Map(), t = /* @__PURE__ */ new Set(["sp", "pic", "grpSp", "graphicFrame", "cxnSp"]), o = a.match(/<(?:p:)?spTree\b/);
  if (!o) return { top: n, groups: m };
  const l = [{ kind: "top" }], s2 = /<(\/?)(?:p:)?(\w+)\b([^>]*?)(\/?)>/g;
  s2.lastIndex = o.index + o[0].length;
  let e;
  for (; (e = s2.exec(a)) !== null; ) {
    const d2 = e[1] === "/", x = e[2], g = e[3], c = e[4] === "/";
    if (d2) {
      if (x === "spTree") break;
      if (l.length > 1) {
        const p = l.pop();
        p.kind === "group" && p.id && m.set(p.id, p.seq);
      }
      continue;
    }
    const r = l[l.length - 1];
    if (x === "cNvPr")
      for (let p = l.length - 1; p >= 0; p--) {
        const i = l[p];
        if (i.kind === "group") {
          if (i.id === null) {
            const f = g.match(/\bid="([^"]+)"/);
            f && (i.id = f[1]);
          }
          break;
        }
      }
    t.has(x) && (r.kind === "top" ? n.push(x) : r.kind === "group" && r.seq.push(x)), c || (x === "grpSp" ? l.push({ kind: "group", id: null, seq: [] }) : l.push({ kind: "other" }));
  }
  return { top: n, groups: m };
}
function an(a, n) {
  if (!a || typeof a != "object") return;
  const m = a, t = m.bgRef;
  let o;
  if (t) {
    const s2 = z(t, n.themeColors);
    s2 && (o = s2.hex);
  }
  const l = m.bgPr;
  if (l) {
    if (l.noFill !== void 0)
      return { type: "none" };
    const s2 = l.solidFill;
    if (s2) {
      const x = z(s2, n.themeColors, o);
      if (x) return { type: "solid", color: x };
    }
    const e = l.gradFill;
    if (e)
      return On(e, n, o);
    const d2 = l.blipFill;
    if (d2) {
      const x = px(d2, n);
      if (x) {
        const g = { type: "picture", src: x.src };
        return x.alpha !== void 0 && (g.alpha = x.alpha), g;
      }
    }
  }
  if (t) {
    const s2 = y(t, "idx");
    if (s2 !== void 0 && s2 >= 1001 && n.bgFillStyles) {
      const e = n.bgFillStyles[s2 - 1001];
      if (e) {
        const d2 = e._type;
        if (d2 === "solidFill") {
          const x = z(e, n.themeColors, o);
          if (x) return { type: "solid", color: x };
        } else if (d2 === "gradFill")
          return On(e, n, o);
      }
    }
    if (o)
      return { type: "solid", color: { hex: o, alpha: 1 } };
  }
}
function On(a, n, m) {
  const t = [];
  let o = 0;
  const l = a.gsLst;
  if (l) {
    const r = C(l.gs);
    for (const p of r) {
      if (!p || typeof p != "object") continue;
      const i = p, f = y(i, "pos"), h = z(i, n.themeColors, m);
      f !== void 0 && h && t.push({ position: V(f), color: h });
    }
  }
  t.sort((r, p) => r.position - p.position);
  const s2 = a.lin;
  if (s2) {
    const r = y(s2, "ang");
    r !== void 0 && (o = za(r));
  }
  let e = "linear", d2, x;
  const g = a.path;
  if (g) {
    e = "radial";
    const r = w(g, "path");
    (r === "circle" || r === "rect" || r === "shape") && (d2 = r);
    const p = g.fillToRect;
    if (p) {
      const i = y(p, "l"), f = y(p, "t"), h = y(p, "r"), L = y(p, "b");
      x = {
        left: i !== void 0 ? i / 1e5 : 0,
        top: f !== void 0 ? f / 1e5 : 0,
        right: h !== void 0 ? h / 1e5 : 0,
        bottom: L !== void 0 ? L / 1e5 : 0
      };
    }
  }
  const c = { type: "gradient", stops: t, angle: o };
  return e === "radial" && (c.gradientType = "radial", d2 && (c.path = d2), x && (c.fillToRect = x)), c;
}
function px(a, n) {
  const m = a.blip;
  if (!m) return;
  const t = m["@_r:embed"] ?? w(m, "embed");
  if (!t) return;
  const o = Ca(t, n.rels, n.basePath, n.imageStore);
  if (!o) return;
  const l = on(m);
  return l !== void 0 ? { src: o.src, alpha: l } : { src: o.src };
}
function ix(a, n) {
  if (!a || typeof a != "object") return;
  const m = a, t = m.nvPicPr, o = t == null ? void 0 : t.cNvPr, l = w(o ?? {}, "id") ?? "0", s2 = m.spPr, e = Ta(s2 == null ? void 0 : s2.xfrm), d2 = (e == null ? void 0 : e.position) ?? { x: 0, y: 0 }, x = (e == null ? void 0 : e.size) ?? { width: 0, height: 0 }, g = t == null ? void 0 : t.nvPr;
  if (g) {
    const A = g.videoFile, T = g.audioFile;
    if (A || T) {
      const j = fx({
        id: l,
        position: d2,
        size: x,
        xfrmData: e,
        spPr: s2,
        nvPr: g,
        blipFill: m.blipFill,
        mediaType: A ? "video" : "audio",
        linkNode: A ?? T
      }, n);
      if (j) return j;
    }
  }
  const c = m.blipFill;
  if (!c) return;
  const r = c.blip;
  if (!r) return;
  const p = r["@_r:embed"] ?? w(r, "embed");
  if (!p) return;
  const i = Ca(p, n.rels, n.basePath, n.imageStore);
  if (!i) return;
  const f = {
    type: "image",
    id: l,
    position: d2,
    size: x,
    src: i.src,
    contentType: i.contentType
  }, h = on(r);
  h !== void 0 && (f.alpha = h);
  const L = e != null && e.rotation || e != null && e.flipH || e != null && e.flipV ? {
    rotation: e == null ? void 0 : e.rotation,
    flipH: e == null ? void 0 : e.flipH,
    flipV: e == null ? void 0 : e.flipV
  } : void 0;
  if (L && (f.transform = L), s2) {
    const A = ln(s2, n.themeColors);
    A && (f.shadow = A);
  }
  const u = c.srcRect;
  if (u) {
    const A = y(u, "t"), T = y(u, "r"), j = y(u, "b"), R = y(u, "l");
    (A !== void 0 || T !== void 0 || j !== void 0 || R !== void 0) && (f.crop = {
      top: A !== void 0 ? V(A) : 0,
      right: T !== void 0 ? V(T) : 0,
      bottom: j !== void 0 ? V(j) : 0,
      left: R !== void 0 ? V(R) : 0
    });
  }
  return f;
}
function fx(a, n) {
  const { id: m, position: t, size: o, xfrmData: l, spPr: s2, nvPr: e, blipFill: d2, mediaType: x, linkNode: g } = a, c = [], r = g["@_r:link"] ?? g["@_r:embed"] ?? w(g, "link") ?? w(g, "embed");
  r && c.push(r);
  const p = e.extLst, i = p ? C(p.ext) : [];
  for (const A of i) {
    if (!A || typeof A != "object") continue;
    const j = A.media;
    if (!j) continue;
    const R = j["@_r:embed"] ?? j["@_r:link"] ?? w(j, "embed") ?? w(j, "link");
    R && !c.includes(R) && c.push(R);
  }
  let f, h;
  for (const A of c) {
    const T = Ca(A, n.rels, n.basePath, n.imageStore);
    if (T) {
      f = T.src, h = T.contentType;
      break;
    }
  }
  if (!f || !h) return;
  const L = {
    type: "media",
    id: m,
    position: t,
    size: o,
    mediaType: x,
    src: f,
    contentType: h
  };
  if (d2) {
    const A = d2.blip;
    if (A) {
      const T = A["@_r:embed"] ?? w(A, "embed");
      if (T) {
        const j = Ca(T, n.rels, n.basePath, n.imageStore);
        j && (L.posterSrc = j.src, L.posterContentType = j.contentType);
      }
    }
  }
  const u = l != null && l.rotation || l != null && l.flipH || l != null && l.flipV ? {
    rotation: l == null ? void 0 : l.rotation,
    flipH: l == null ? void 0 : l.flipH,
    flipV: l == null ? void 0 : l.flipV
  } : void 0;
  if (u && (L.transform = u), s2) {
    const A = ln(s2, n.themeColors);
    A && (L.shadow = A);
  }
  return L;
}
function hx(a, n) {
  var j;
  if (!a || typeof a != "object") return;
  const m = a, t = m.nvGrpSpPr, o = t == null ? void 0 : t.cNvPr, l = w(o ?? {}, "id") ?? "0", s2 = m.grpSpPr, e = Ta(s2 == null ? void 0 : s2.xfrm), d2 = (e == null ? void 0 : e.position) ?? { x: 0, y: 0 }, x = (e == null ? void 0 : e.size) ?? { width: 0, height: 0 }, g = s2 == null ? void 0 : s2.xfrm;
  let c = { x: 0, y: 0 }, r = { width: 0, height: 0 };
  if (g) {
    const R = g.chOff;
    if (R) {
      const $ = y(R, "x"), b = y(R, "y");
      $ !== void 0 && b !== void 0 && (c = { x: q($), y: q(b) });
    }
    const Y2 = g.chExt;
    if (Y2) {
      const $ = y(Y2, "cx"), b = y(Y2, "cy");
      $ !== void 0 && b !== void 0 && (r = { width: q($), height: q(b) });
    }
  }
  const p = { rels: n.rels, basePath: n.basePath, imageStore: n.imageStore }, f = (s2 ? Fa(s2, n.themeColors, void 0, p, n.groupFill) : void 0) ?? n.groupFill, h = (j = n.groupTagSequences) == null ? void 0 : j.get(l), L = f ? { ...n, groupFill: f } : n, u = Ga(m, L, h), A = e != null && e.rotation || e != null && e.flipH || e != null && e.flipV ? {
    rotation: e == null ? void 0 : e.rotation,
    flipH: e == null ? void 0 : e.flipH,
    flipV: e == null ? void 0 : e.flipV
  } : void 0, T = {
    type: "group",
    id: l,
    position: d2,
    size: x,
    childOffset: c,
    childExtent: r,
    children: u
  };
  return A && (T.transform = A), T;
}
function Jn(a) {
  const n = a.childExtent.width > 0 ? a.size.width / a.childExtent.width : 1, m = a.childExtent.height > 0 ? a.size.height / a.childExtent.height : 1, t = a.childOffset.x, o = a.childOffset.y;
  if (n !== 1 || m !== 1 || t !== 0 || o !== 0)
    for (const s2 of a.children)
      s2.position = {
        x: (s2.position.x - t) * n,
        y: (s2.position.y - o) * m
      }, s2.size = {
        width: s2.size.width * n,
        height: s2.size.height * m
      };
  for (const s2 of a.children)
    s2.type === "group" && Jn(s2);
  a.childOffset = { x: 0, y: 0 }, a.childExtent = { width: a.size.width, height: a.size.height };
}
function yx(a, n) {
  var e, d2;
  if (!a || typeof a != "object") return;
  const m = a, t = m.graphic;
  if (!t) return;
  const o = t.graphicData;
  if (!o) return;
  if (o.tbl)
    return M0(m, n);
  const l = o.chart;
  if (l && n.chartStore) {
    const x = l["@_r:id"] ?? l["@_id"];
    if (x) {
      const g = n.rels.get(x);
      if (g) {
        const c = K(n.basePath, g.target), r = n.chartStore.get(c);
        if (r) {
          const p = _0(r, n.themeColors);
          if (p) {
            const i = Ta(m.xfrm ?? ((e = m.spPr) == null ? void 0 : e.xfrm)), f = (i == null ? void 0 : i.position) ?? { x: 0, y: 0 }, h = (i == null ? void 0 : i.size) ?? { width: 100, height: 100 };
            return {
              type: "chart",
              id: w(((d2 = m.nvGraphicFramePr) == null ? void 0 : d2.cNvPr) ?? {}, "id") ?? "0",
              position: f,
              size: h,
              chartType: p.chartType,
              categories: p.categories,
              series: p.series,
              holeSize: p.holeSize,
              firstSliceAngle: p.firstSliceAngle,
              barGrouping: p.barGrouping,
              gapWidth: p.gapWidth,
              overlap: p.overlap,
              dataLabels: p.dataLabels,
              seriesDataLabels: p.seriesDataLabels,
              categoryAxis: p.categoryAxis,
              valueAxis: p.valueAxis,
              legend: p.legend
            };
          }
        }
      }
    }
  }
  const s2 = w(o, "uri");
  if (s2 && s2.includes("/diagram")) {
    const x = Tx(m, o, n);
    if (x) return x;
  }
}
function Tx(a, n, m) {
  var k, X;
  if (!m.diagramStore) return;
  const t = a.nvGraphicFramePr, o = t == null ? void 0 : t.cNvPr, l = w(o ?? {}, "id") ?? "0", s2 = Ta(a.xfrm ?? ((k = a.spPr) == null ? void 0 : k.xfrm)), e = (s2 == null ? void 0 : s2.position) ?? { x: 0, y: 0 }, d2 = (s2 == null ? void 0 : s2.size) ?? { width: 0, height: 0 }, x = n.relIds;
  if (!x) return;
  const g = x["@_r:dm"] ?? x["@_dm"];
  if (!g) return;
  const c = m.rels.get(g);
  if (!c) return;
  const r = K(m.basePath, c.target), p = m.diagramStore.get(r);
  if (!p) return;
  const i = p.match(/<[^:<>]*:?dataModelExt\b[^>]*\brelId="([^"]+)"/);
  if (!i) return;
  const f = i[1], h = (X = m.diagramRelsStore) == null ? void 0 : X.get(r);
  let L = h == null ? void 0 : h.get(f), u = r.substring(0, r.lastIndexOf("/"));
  if (L || (L = m.rels.get(f), u = m.basePath), !L) return;
  const A = K(u, L.target), T = m.diagramStore.get(A);
  if (!T) return;
  const j = dn(T), R = xn.parse(j), Y2 = R == null ? void 0 : R.drawing, $ = Y2 == null ? void 0 : Y2.spTree;
  if (!$) return;
  const b = gn(T), F = {
    ...m,
    rawXml: T,
    topTagSequence: b.top,
    groupTagSequences: b.groups,
    layoutPlaceholders: void 0,
    masterPlaceholders: void 0,
    inheritedBackground: void 0
  }, I2 = Ga($, F, b.top);
  return I2.length === 0 ? void 0 : {
    type: "group",
    id: l,
    position: e,
    size: d2,
    childOffset: { x: 0, y: 0 },
    childExtent: { width: d2.width, height: d2.height },
    children: I2
  };
}
function wx(a, n) {
  if (!a || typeof a != "object") return;
  const m = a, t = m.nvCxnSpPr, o = t == null ? void 0 : t.cNvPr, l = w(o ?? {}, "id") ?? "0", s2 = t == null ? void 0 : t.cNvCxnSpPr, e = (Y2) => {
    if (!Y2) return;
    const $ = w(Y2, "id"), b = y(Y2, "idx");
    if (!(!$ || b === void 0))
      return { shapeId: $, siteIdx: b };
  }, d2 = e(s2 == null ? void 0 : s2.stCxn), x = e(s2 == null ? void 0 : s2.endCxn), g = m.spPr;
  if (!g) return;
  const c = Ta(g.xfrm), r = (c == null ? void 0 : c.position) ?? { x: 0, y: 0 }, p = (c == null ? void 0 : c.size) ?? { width: 0, height: 0 }, i = c != null && c.rotation || c != null && c.flipH || c != null && c.flipV ? { rotation: c == null ? void 0 : c.rotation, flipH: c == null ? void 0 : c.flipH, flipV: c == null ? void 0 : c.flipV } : void 0, f = g.prstGeom, h = w(f ?? {}, "prst") ?? "line", L = m.style, u = L == null ? void 0 : L.lnRef;
  let A;
  if (u) {
    const Y2 = z(u, n.themeColors);
    Y2 && (A = Y2.hex);
  }
  const T = g.ln !== void 0;
  let j = Ja(g.ln, n.themeColors, A);
  if (!j && !T && A && u) {
    const Y2 = y(u, "idx");
    Y2 && Y2 > 0 && (j = {
      width: 1,
      color: { hex: A, alpha: 1 },
      dashStyle: "solid",
      lineJoin: "round"
    });
  }
  const R = {
    type: "shape",
    id: l,
    position: r,
    size: p,
    geometry: { kind: "preset", preset: h }
  };
  return i && (R.transform = i), j && (R.stroke = j), (d2 || x) && (R.connector = {}, d2 && (R.connector.stCxn = d2), x && (R.connector.endCxn = x)), R;
}
var vx = ["noFill", "solidFill", "gradFill", "blipFill", "pattFill"];
var Lx = ["prstGeom", "custGeom"];
var ux = ["noAutofit", "normAutofit", "spAutoFit"];
function Ax(a, n) {
  if (!a) return false;
  for (const m of n) if (a[m] !== void 0) return true;
  return false;
}
function nn(a, n, m) {
  for (const t of n)
    if (t && Ax(t, m)) {
      for (const o of m)
        t[o] !== void 0 && (a[o] = t[o]);
      return;
    }
}
function bx(a, n, m) {
  const t = {}, o = ["xfrm", "ln", "effectLst", "effectDag", "scene3d", "sp3d"];
  for (const l of o)
    (a == null ? void 0 : a[l]) !== void 0 ? t[l] = a[l] : (n == null ? void 0 : n[l]) !== void 0 ? t[l] = n[l] : (m == null ? void 0 : m[l]) !== void 0 && (t[l] = m[l]);
  for (const l of [m, n, a])
    if (l)
      for (const s2 of Object.keys(l))
        s2.startsWith("@_") && (t[s2] = l[s2]);
  return nn(t, [a, n, m], vx), nn(t, [a, n, m], Lx), t;
}
function jx(a, n, m) {
  if (!a && !n && !m) return;
  const t = {};
  for (const l of [m, n, a])
    if (l)
      for (const s2 of Object.keys(l))
        s2.startsWith("@_") && (t[s2] = l[s2]);
  const o = ["prstTxWarp", "flatTx"];
  for (const l of o)
    (a == null ? void 0 : a[l]) !== void 0 ? t[l] = a[l] : (n == null ? void 0 : n[l]) !== void 0 ? t[l] = n[l] : (m == null ? void 0 : m[l]) !== void 0 && (t[l] = m[l]);
  return nn(t, [a, n, m], ux), t;
}
function $x(a, n, m) {
  const t = a.spPr, o = bx(t, n == null ? void 0 : n.spPrNode, m == null ? void 0 : m.spPrNode), l = a.txBody, s2 = jx(
    l == null ? void 0 : l.bodyPr,
    n == null ? void 0 : n.bodyPrNode,
    m == null ? void 0 : m.bodyPrNode
  ), e = l ? { ...l } : void 0;
  if (e && s2 && (e.bodyPr = s2), e && (l == null ? void 0 : l.lstStyle) === void 0) {
    const g = (n == null ? void 0 : n.lstStyleNode) ?? (m == null ? void 0 : m.lstStyleNode);
    g !== void 0 && (e.lstStyle = g);
  }
  const d2 = a.style ?? (n == null ? void 0 : n.styleNode) ?? (m == null ? void 0 : m.styleNode), x = { ...a, spPr: o };
  return e && (x.txBody = e), d2 && (x.style = d2), x;
}
function Ea(a, n) {
  const m = a.nvSpPr, t = m == null ? void 0 : m.nvPr, o = t == null ? void 0 : t.ph;
  if (!o) return;
  const l = w(o, "type"), s2 = y(o, "idx");
  if (l && s2 !== void 0) {
    const e = n.find((d2) => d2.type === l && d2.idx === s2);
    if (e) return e;
  }
  if (l) {
    const e = n.find((d2) => d2.type === l);
    if (e) return e;
  }
  if (s2 !== void 0) {
    const e = n.find((d2) => d2.idx === s2);
    if (e) return e;
  }
}
var Rx = {
  ctr: "center",
  r: "right",
  just: "justify",
  l: "left"
};
function Yx(a, n) {
  if (n)
    return a === "title" || a === "ctrTitle" ? n.titleStyle : a === "body" || a === "subTitle" ? n.bodyStyle : n.otherStyle;
}
function Xx(a) {
  const n = {};
  a.fontFamily && (n.fontFamily = a.fontFamily), a.eaFontFamily && (n.eaFontFamily = a.eaFontFamily), a.fontSize !== void 0 && (n.fontSize = a.fontSize), a.bold !== void 0 && (n.bold = a.bold), a.italic !== void 0 && (n.italic = a.italic), a.color && (n.color = { hex: a.color, alpha: 1 }), a.underline !== void 0 && (n.underline = a.underline), a.strikethrough !== void 0 && (n.strikethrough = a.strikethrough), a.letterSpacing !== void 0 && (n.letterSpacing = a.letterSpacing), a.baseline !== void 0 && (n.baseline = a.baseline);
  const m = {};
  return a.alignment && (m.alignment = Rx[a.alignment]), a.lineSpacing && (m.lineSpacing = a.lineSpacing), a.spaceBefore && (m.spaceBefore = a.spaceBefore), a.spaceAfter && (m.spaceAfter = a.spaceAfter), a.indent !== void 0 && (m.indent = a.indent), a.marginLeft !== void 0 && (m.marginLeft = a.marginLeft), a.bulletNone ? m.bulletNone = true : a.bullet && (m.bullet = a.bullet), { run: n, paragraph: m };
}
function Cx(...a) {
  const n = { levels: {} };
  for (const m of a)
    if (m)
      for (const [t, o] of Object.entries(m.levels)) {
        const l = Number(t), { run: s2, paragraph: e } = Xx(o);
        if (!n.levels[l])
          n.levels[l] = { run: { ...s2 }, paragraph: { ...e } };
        else {
          const d2 = n.levels[l];
          d2.run || (d2.run = {});
          for (const [x, g] of Object.entries(s2))
            g !== void 0 && (d2.run[x] = g);
          d2.paragraph || (d2.paragraph = {});
          for (const [x, g] of Object.entries(e))
            g !== void 0 && (d2.paragraph[x] = g);
          e.bulletNone && (d2.paragraph.bullet = void 0);
        }
      }
  return n;
}
function Fx(a, n) {
  const m = a.nvSpPr, t = m == null ? void 0 : m.nvPr, o = t == null ? void 0 : t.ph;
  if (!o) return;
  const l = w(o, "type"), s2 = Yx(l, n.masterTextStyles);
  let e;
  if (n.masterPlaceholders) {
    const x = Ea(a, n.masterPlaceholders);
    e = x == null ? void 0 : x.textDefaults;
  }
  let d2;
  if (n.layoutPlaceholders) {
    const x = Ea(a, n.layoutPlaceholders);
    d2 = x == null ? void 0 : x.textDefaults;
  }
  if (!(!s2 && !e && !d2))
    return Cx(s2, e, d2);
}
function Ga(a, n, m) {
  const t = {
    themeColors: n.themeColors,
    themeFonts: n.themeFonts,
    rawXml: n.rawXml,
    rels: n.rels,
    basePath: n.basePath,
    imageStore: n.imageStore,
    fillStyles: n.fillStyles,
    lnStyles: n.lnStyles,
    groupFill: n.groupFill
  }, o = {}, l = (e, d2) => {
    d2 && (o[e] || (o[e] = []), o[e].push(d2));
  };
  for (const e of C(a.sp)) {
    const d2 = Fx(e, n), x = d2 ? { ...t, externalTextDefaults: d2 } : t, g = n.layoutPlaceholders ? Ea(e, n.layoutPlaceholders) : void 0, c = n.masterPlaceholders ? Ea(e, n.masterPlaceholders) : void 0, r = g || c ? $x(e, g, c) : e, p = R0(r, x);
    l("sp", p);
  }
  for (const e of C(a.pic)) l("pic", ix(e, n));
  for (const e of C(a.cxnSp)) l("cxnSp", wx(e, t));
  for (const e of C(a.graphicFrame)) l("graphicFrame", yx(e, n));
  for (const e of C(a.grpSp)) l("grpSp", hx(e, n));
  const s2 = Object.values(o).flat();
  if (m && m.length > 0) {
    const e = {}, d2 = [];
    for (const x of m) {
      const g = o[x];
      if (!g) continue;
      const c = e[x] ?? 0;
      c < g.length && (d2.push(g[c]), e[x] = c + 1);
    }
    for (const x of s2)
      d2.includes(x) || d2.push(x);
    return d2;
  }
  return s2;
}
function am(a) {
  if (!a || typeof a != "object") return false;
  const n = a, m = n.nvSpPr, t = n.nvPicPr, o = n.nvGrpSpPr, l = (m == null ? void 0 : m.nvPr) ?? (t == null ? void 0 : t.nvPr) ?? (o == null ? void 0 : o.nvPr);
  if ((l == null ? void 0 : l.ph) !== void 0) return true;
  if (n.nvGrpSpPr !== void 0) {
    const s2 = C(n.sp), e = C(n.pic), d2 = [...s2, ...e];
    if (d2.length > 0 && d2.every((x) => am(x)))
      return true;
  }
  return false;
}
function In(a, n, m) {
  const t = { ...m, rawXml: a }, o = dn(a), l = xn.parse(o), s2 = l == null ? void 0 : l[n];
  if (!s2) return [];
  const e = s2.cSld;
  if (!e) return [];
  const d2 = e.spTree;
  if (!d2) return [];
  const x = gn(a);
  t.topTagSequence = x.top, t.groupTagSequences = x.groups;
  const g = { ...d2 };
  for (const c of ["sp", "pic", "grpSp"]) {
    const r = C(g[c]);
    g[c] = r.filter((p) => !am(p));
  }
  return Ga(g, t, x.top);
}
function Bx(a, n, m) {
  const t = { ...m, rawXml: a }, o = dn(a), l = xn.parse(o), s2 = l == null ? void 0 : l.sld, e = {
    index: n,
    elements: []
  };
  if (!s2) return e;
  const d2 = s2.cSld;
  if (!d2) return e;
  const x = d2.bg ?? s2.bg;
  if (x) {
    const i = an(x, t);
    i && (e.background = i);
  }
  !e.background && t.inheritedBackground && (e.background = t.inheritedBackground);
  const g = gn(a);
  t.topTagSequence = g.top, t.groupTagSequences = g.groups;
  const c = d2.spTree;
  c && (e.elements = Ga(c, t, g.top));
  for (const i of e.elements)
    i.type === "group" && Jn(i);
  const r = K0(s2);
  r && (e.transition = r);
  const p = rx(s2);
  return p && (e.animations = p), e;
}
function pa(a, n) {
  n && a.add(n);
}
function Dn(a, n) {
  var m;
  for (const t of n.paragraphs) {
    pa(a, (m = t.properties.bullet) == null ? void 0 : m.fontFamily);
    for (const o of t.runs)
      pa(a, o.properties.fontFamily), pa(a, o.properties.eaFontFamily);
  }
}
function nm(a, n) {
  switch (n.type) {
    case "shape":
      n.textBody && Dn(a, n.textBody);
      break;
    case "table":
      for (const m of n.rows)
        for (const t of m.cells)
          t.textBody && Dn(a, t.textBody);
      break;
    case "group":
      for (const m of n.children)
        nm(a, m);
      break;
  }
}
function kx(a) {
  const n = /* @__PURE__ */ new Set(), m = a.theme.fonts;
  pa(n, m.majorLatin), pa(n, m.minorLatin), pa(n, m.majorEastAsia), pa(n, m.minorEastAsia);
  for (const t of a.slides)
    for (const o of t.elements)
      nm(n, o);
  return Array.from(n);
}
function Aa(a, n) {
  return a[n] | a[n + 1] << 8 | a[n + 2] << 16 | a[n + 3] << 24;
}
function ba(a, n) {
  return a[n] | a[n + 1] << 8;
}
var qx = 20556;
var Mx = 4;
function Px(a) {
  if (a.length < 82 || ba(a, 34) !== qx) return;
  const m = Aa(a, 0) >>> 0, t = Aa(a, 4) >>> 0, o = Aa(a, 8) >>> 0, l = Aa(a, 12) >>> 0, s2 = Aa(a, 28) >>> 0, e = a[27];
  let d2 = 82;
  const x = ba(a, d2);
  d2 += 2;
  let g = "";
  if (x > 0 && d2 + x <= a.length) {
    const c = a.slice(d2, d2 + x);
    g = Sx(c), d2 += x;
  }
  for (let c = 0; c < 3 && !(d2 + 4 > a.length); c++) {
    d2 += 2;
    const r = ba(a, d2);
    d2 += 2 + r;
  }
  if (o >= 131073 && d2 + 2 <= a.length) {
    const c = ba(a, d2);
    d2 += 2 + c;
  }
  if (o >= 131074 && d2 + 12 <= a.length) {
    d2 += 4, d2 += 4, d2 += 2;
    const c = ba(a, d2);
    d2 += 2 + c;
  }
  return {
    eotSize: m,
    fontDataSize: t,
    version: o,
    flags: l,
    familyName: g,
    weight: s2,
    italic: e !== 0,
    isCompressed: (l & Mx) !== 0,
    fontDataOffset: d2
  };
}
function Sx(a) {
  const n = [];
  for (let m = 0; m < a.length - 1; m += 2) {
    const t = a[m] | a[m + 1] << 8;
    if (t === 0) break;
    n.push(String.fromCharCode(t));
  }
  return n.join("");
}
var Ox = 65536;
var Ix = 1330926671;
function En(a) {
  if (a.length < 4) return null;
  const n = a[0] << 24 | a[1] << 16 | a[2] << 8 | a[3];
  return n === Ox ? "font/ttf" : n === Ix ? "font/otf" : null;
}
async function Dx(a, n, m) {
  if (!n || typeof n != "object") return [];
  const o = n.presentation;
  if (!o) return [];
  const l = o.embeddedFontLst;
  if (!l) return [];
  const s2 = C(l.embeddedFont);
  if (!s2 || s2.length === 0) return [];
  const e = [];
  for (const d2 of s2) {
    if (!d2 || typeof d2 != "object") continue;
    const x = d2, g = x.font;
    if (!g) continue;
    const c = w(g, "typeface");
    if (!c) continue;
    const r = [
      { key: "regular", style: "regular", weight: 400, italic: false },
      { key: "bold", style: "bold", weight: 700, italic: false },
      { key: "italic", style: "italic", weight: 400, italic: true },
      { key: "boldItalic", style: "boldItalic", weight: 700, italic: true }
    ];
    for (const p of r) {
      const i = x[p.key];
      if (!i) continue;
      const f = i["@_r:id"] ?? i["@_id"];
      if (!f) continue;
      const h = m.get(f);
      if (!h) continue;
      const L = K("ppt", h.target), u = a.file(L);
      if (!u) continue;
      const A = await u.async("uint8array"), T = {
        familyName: c,
        style: p.style,
        weight: p.weight,
        italic: p.italic
      }, j = En(A);
      if (j) {
        T.data = A, T.contentType = j, e.push(T);
        continue;
      }
      const R = Px(A);
      if (R)
        if (R.weight && (T.weight = R.weight), T.italic = R.italic, R.isCompressed)
          T.mtxCompressed = true, e.push(T);
        else {
          const Y2 = R.fontDataOffset, $ = Y2 + R.fontDataSize;
          if ($ <= A.length) {
            const b = A.slice(Y2, $), F = En(b);
            T.data = b, T.contentType = F ?? "font/ttf", e.push(T);
          } else
            T.mtxCompressed = true, e.push(T);
        }
    }
  }
  return e;
}
async function Ex(a) {
  const n = /* @__PURE__ */ new Map(), m = a.folder("ppt/charts");
  if (!m) return n;
  const t = [];
  return m.forEach((o, l) => {
    o.endsWith(".xml") && !o.includes("/") && t.push(
      l.async("string").then((s2) => {
        n.set(`ppt/charts/${o}`, s2);
      })
    );
  }), await Promise.all(t), n;
}
async function zx(a) {
  const n = /* @__PURE__ */ new Map(), m = /* @__PURE__ */ new Map(), t = a.folder("ppt/diagrams");
  if (!t) return { store: n, relsStore: m };
  const o = [];
  return t.forEach((l, s2) => {
    if (l.endsWith(".xml")) {
      if (!l.includes("/"))
        o.push(
          s2.async("string").then((e) => {
            n.set(`ppt/diagrams/${l}`, e);
          })
        );
      else if (l.startsWith("_rels/") && l.endsWith(".rels")) {
        const x = `ppt/diagrams/${l.substring(6).replace(/\.rels$/, "")}`;
        o.push(
          s2.async("string").then((g) => {
            m.set(x, Hn(g));
          })
        );
      }
    }
  }), await Promise.all(o), { store: n, relsStore: m };
}
var $a = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  processEntities: true,
  htmlEntities: true,
  isArray: (a) => [
    "sld",
    "sp",
    "pic",
    "grpSp",
    "graphicFrame",
    "p",
    "r",
    "br",
    "tr",
    "tc",
    "gs",
    "gd",
    "path",
    "Relationship",
    "sldId",
    "sldMasterId",
    "sldLayoutId",
    "embeddedFont",
    "Override",
    "Default"
  ].includes(a)
});
async function Gx(a, n) {
  const m = a.file(n);
  if (!m) return;
  const t = await m.async("text");
  return $a.parse(t);
}
async function xa(a, n) {
  const m = a.file(n);
  if (m)
    return m.async("text");
}
async function Oa(a, n) {
  const m = n.substring(0, n.lastIndexOf("/")), t = n.substring(n.lastIndexOf("/") + 1), o = `${m}/_rels/${t}.rels`, l = await xa(a, o);
  return l ? Hn(l) : /* @__PURE__ */ new Map();
}
function mm(a, n) {
  const m = { hex: n, alpha: 1 };
  for (const t of a)
    if (t.type === "shape" && t.textBody)
      for (const o of t.textBody.paragraphs)
        for (const l of o.runs)
          l.properties.color || (l.properties.color = m);
    else t.type === "group" && t.children && mm(t.children, n);
}
function Hx(a) {
  const n = {
    slideSize: { width: 720, height: 540 },
    // Default 10" x 7.5" at 72 pt/inch
    slideRIds: []
  };
  if (!a || typeof a != "object") return n;
  const t = a.presentation;
  if (!t) return n;
  const o = t.sldSz;
  if (o) {
    const s2 = y(o, "cx"), e = y(o, "cy");
    s2 !== void 0 && e !== void 0 && (n.slideSize = { width: q(s2), height: q(e) });
  }
  const l = t.sldIdLst;
  if (l) {
    const s2 = C(l.sldId);
    for (const e of s2) {
      if (!e || typeof e != "object") continue;
      const x = e["@_r:id"];
      x && n.slideRIds.push(x);
    }
  }
  return n;
}
async function Jx(a) {
  const n = await import_jszip.default.loadAsync(a), m = p0(n), t = Ex(n), o = zx(n), l = await Oa(n, "ppt/presentation.xml"), s2 = await Gx(n, "ppt/presentation.xml"), e = Hx(s2), d2 = Dx(n, s2, l);
  let x = {
    colors: {
      dk1: "#000000",
      dk2: "#44546A",
      lt1: "#FFFFFF",
      lt2: "#E7E6E6",
      accent1: "#4472C4",
      accent2: "#ED7D31",
      accent3: "#A5A5A5",
      accent4: "#FFC000",
      accent5: "#5B9BD5",
      accent6: "#70AD47",
      hlink: "#0563C1",
      folHlink: "#954F72"
    },
    fonts: { majorLatin: "Calibri", minorLatin: "Calibri" }
  };
  for (const [, X] of l)
    if (X.type === "theme") {
      const B = K("ppt", X.target), S2 = await xa(n, B);
      S2 && (x = jn(S2));
      break;
    }
  const g = await m, c = await t, { store: r, relsStore: p } = await o;
  let i;
  for (const [, X] of l)
    if (X.type === "tableStyles") {
      const B = K("ppt", X.target), S2 = await xa(n, B);
      S2 && (i = qn(S2));
      break;
    }
  if (!i) {
    const X = await xa(n, "ppt/tableStyles.xml");
    X && (i = qn(X));
  }
  const f = /* @__PURE__ */ new Map(), h = /* @__PURE__ */ new Map(), L = /* @__PURE__ */ new Map(), u = /* @__PURE__ */ new Map(), A = /* @__PURE__ */ new Map(), T = /* @__PURE__ */ new Map(), j = /* @__PURE__ */ new Map(), R = /* @__PURE__ */ new Map(), Y2 = /* @__PURE__ */ new Map(), $ = /* @__PURE__ */ new Map();
  for (const [, X] of l)
    if (X.type === "slideMaster") {
      const B = K("ppt", X.target), S2 = await xa(n, B);
      if (S2) {
        const _ = await Oa(n, B), Z = B.substring(0, B.lastIndexOf("/"));
        let M = x;
        for (const [, E] of _)
          if (E.type === "theme") {
            const P = K(Z, E.target), N2 = await xa(n, P);
            N2 && (M = jn(N2));
            break;
          }
        j.set(B, M);
        const aa = $a.parse(S2), D = aa == null ? void 0 : aa.sldMaster, J2 = D == null ? void 0 : D.clrMap;
        let O = M.colors;
        if (J2) {
          const E = {};
          for (const P of ["bg1", "tx1", "bg2", "tx2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"]) {
            const N2 = w(J2, P);
            N2 && (E[P] = N2);
          }
          O = Va(M.colors, E);
        }
        const na = g0(S2, O);
        R.set(B, na);
        const oa = (E, P) => ({
          themeColors: O,
          themeFonts: M.fonts,
          rels: E,
          basePath: P,
          imageStore: g,
          bgFillStyles: M.bgFillStyles,
          fillStyles: M.fillStyles,
          lnStyles: M.lnStyles
        }), wa = $a.parse(S2), ea = wa == null ? void 0 : wa.sldMaster, da = ea == null ? void 0 : ea.cSld, ca = (da == null ? void 0 : da.bg) ?? (ea == null ? void 0 : ea.bg);
        if (ca) {
          const E = an(ca, oa(_, Z));
          E && f.set(B, E);
        }
        const ua = In(S2, "sldMaster", oa(_, Z));
        ua.length > 0 && A.set(B, ua);
        for (const [, E] of _)
          if (E.type === "slideLayout") {
            const P = K(Z, E.target), N2 = await xa(n, P);
            if (N2) {
              L.set(P, B);
              const ma = $a.parse(N2), Q2 = ma == null ? void 0 : ma.sldLayout;
              let va = O;
              const cn = Q2 == null ? void 0 : Q2.clrMapOvr;
              if (cn) {
                const ta = cn.overrideClrMapping;
                if (ta) {
                  const Ba = {};
                  for (const Tn of ["bg1", "tx1", "bg2", "tx2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"]) {
                    const wn = w(ta, Tn);
                    wn && (Ba[Tn] = wn);
                  }
                  va = Va(M.colors, Ba);
                }
              }
              if (Y2.set(P, va), va !== O && na.txStylesNode) {
                const ta = Ua(na.txStylesNode, va);
                ta && $.set(P, ta);
              }
              const tm = c0(N2, va);
              u.set(P, tm.placeholders);
              const rn = await Oa(n, P), pn = P.substring(0, P.lastIndexOf("/")), fn = (ta, Ba) => ({
                themeColors: va,
                themeFonts: M.fonts,
                rels: ta,
                basePath: Ba,
                imageStore: g,
                bgFillStyles: M.bgFillStyles
              }), Ha = Q2 == null ? void 0 : Q2.cSld, hn = (Ha == null ? void 0 : Ha.bg) ?? (Q2 == null ? void 0 : Q2.bg);
              if (hn) {
                const ta = an(hn, fn(rn, pn));
                ta && h.set(P, ta);
              }
              const yn = In(N2, "sldLayout", fn(rn, pn));
              yn.length > 0 && T.set(P, yn);
            }
          }
      }
    }
  const b = [];
  if (e.slideRIds.length > 0)
    for (const X of e.slideRIds) {
      const B = l.get(X);
      B && B.type === "slide" && b.push(K("ppt", B.target));
    }
  if (b.length === 0) {
    for (const [, X] of l)
      X.type === "slide" && b.push(K("ppt", X.target));
    b.sort((X, B) => {
      var Z, M;
      const S2 = parseInt(((Z = X.match(/slide(\d+)/)) == null ? void 0 : Z[1]) ?? "0", 10), _ = parseInt(((M = B.match(/slide(\d+)/)) == null ? void 0 : M[1]) ?? "0", 10);
      return S2 - _;
    });
  }
  const F = [];
  for (let X = 0; X < b.length; X++) {
    const B = b[X], S2 = await xa(n, B);
    if (!S2) continue;
    const _ = await Oa(n, B), Z = B.substring(0, B.lastIndexOf("/"));
    let M, aa, D = x, J2 = x.colors, O, na;
    for (const [, E] of _)
      if (E.type === "slideLayout") {
        const P = K(Z, E.target);
        M = h.get(P), aa = u.get(P);
        const N2 = L.get(P);
        N2 && (D = j.get(N2) ?? x, J2 = Y2.get(P) ?? D.colors, O = R.get(N2), na = $.get(P) ?? (O == null ? void 0 : O.textStyles), M || (M = f.get(N2)));
        break;
      }
    const oa = $a.parse(S2), wa = oa == null ? void 0 : oa.sld;
    if (wa) {
      const E = wa.clrMapOvr;
      if (E) {
        const P = E.overrideClrMapping;
        if (P) {
          const N2 = {};
          for (const ma of ["bg1", "tx1", "bg2", "tx2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"]) {
            const Q2 = w(P, ma);
            Q2 && (N2[ma] = Q2);
          }
          if (J2 = Va(D.colors, N2), O != null && O.txStylesNode) {
            const ma = Ua(O.txStylesNode, J2);
            ma && (na = ma);
          }
        }
      }
    }
    const ea = {
      themeColors: J2,
      themeFonts: D.fonts,
      rels: _,
      basePath: Z,
      imageStore: g,
      chartStore: c,
      diagramStore: r,
      diagramRelsStore: p,
      tableStyles: i,
      inheritedBackground: M,
      layoutPlaceholders: aa,
      masterTextStyles: na ?? (O == null ? void 0 : O.textStyles),
      masterPlaceholders: O == null ? void 0 : O.placeholders,
      bgFillStyles: D.bgFillStyles,
      fillStyles: D.fillStyles,
      lnStyles: D.lnStyles
    }, da = Bx(S2, X, ea), ca = [];
    for (const [, E] of _)
      if (E.type === "slideLayout") {
        const P = K(Z, E.target), N2 = L.get(P);
        if (N2) {
          const Q2 = A.get(N2);
          Q2 && ca.push(...Q2);
        }
        const ma = T.get(P);
        ma && ca.push(...ma);
        break;
      }
    ca.length > 0 && (da.elements = [...ca, ...da.elements]);
    const ua = Nn("tx1", J2);
    ua && mm(da.elements, ua), F.push(da);
  }
  const I2 = await d2, H = j.size > 0 ? j.values().next().value ?? x : x, k = {
    slideSize: e.slideSize,
    theme: H,
    slides: F,
    fonts: { usedFontFamilies: [], embeddedFonts: I2 }
  };
  return k.fonts.usedFontFamilies = kx(k), k;
}

// node_modules/@pagus-kit/renderer/dist/index.js
function At2(t) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function Q(t) {
  return t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function d(t) {
  return t / 72 * 96;
}
function s(t) {
  return Number(t.toFixed(4)).toString();
}
function J(t) {
  return Object.entries(t).filter(([, o]) => o !== void 0 && o !== "").map(([o, e]) => `${o}:${e}`).join(";");
}
function re2(t = "pagus") {
  let o = 0;
  return () => `${t}_${++o}`;
}
function Tt2(t) {
  const o = (t == null ? void 0 : t.left) ?? 0, e = (t == null ? void 0 : t.top) ?? 0, n = (t == null ? void 0 : t.right) ?? 0, r = (t == null ? void 0 : t.bottom) ?? 0, i = (o + (1 - n)) / 2, a = (e + (1 - r)) / 2;
  let c = 0;
  for (const [l, h] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const $ = Math.hypot(l - i, h - a);
    $ > c && (c = $);
  }
  return { cx: i, cy: a, r: c, fx: i, fy: a };
}
function ie2(t, o) {
  const e = o;
  switch (t) {
    case "solid":
      return;
    case "dot":
      return `${e} ${e * 2}`;
    case "dash":
      return `${e * 4} ${e * 3}`;
    case "lgDash":
      return `${e * 8} ${e * 3}`;
    case "dashDot":
      return `${e * 4} ${e * 3} ${e} ${e * 3}`;
    case "lgDashDot":
      return `${e * 8} ${e * 3} ${e} ${e * 3}`;
    case "lgDashDotDot":
      return `${e * 8} ${e * 3} ${e} ${e * 3} ${e} ${e * 3}`;
    case "sysDash":
      return `${e * 3} ${e}`;
    case "sysDot":
      return `${e} ${e}`;
    case "sysDashDot":
      return `${e * 3} ${e} ${e} ${e}`;
    case "sysDashDotDot":
      return `${e * 3} ${e} ${e} ${e} ${e} ${e}`;
  }
}
function se2(t, o, e, n) {
  const r = s(d(o.width)), i = s(d(o.height));
  if (!t)
    return `<rect width="${r}" height="${i}" fill="#FFFFFF"/>`;
  if (t.type === "none")
    return `<rect width="${r}" height="${i}" fill="#FFFFFF"/>`;
  if (t.type === "solid") {
    let a = `fill="${t.color.hex}"`;
    return t.color.alpha < 1 && (a += ` fill-opacity="${s(t.color.alpha)}"`), `<rect width="${r}" height="${i}" ${a}/>`;
  }
  if (t.type === "gradient") {
    const a = n(), c = t.stops.map((l) => {
      const h = l.color.alpha < 1 ? ` stop-opacity="${s(l.color.alpha)}"` : "";
      return `<stop offset="${s(l.position * 100)}%" stop-color="${l.color.hex}"${h}/>`;
    }).join("");
    if (t.gradientType === "radial") {
      const { cx: l, cy: h, r: $, fx: f, fy: p } = Tt2(t.fillToRect);
      e.push(
        `<radialGradient id="${a}" cx="${s(l * 100)}%" cy="${s(h * 100)}%" r="${s($ * 100)}%" fx="${s(f * 100)}%" fy="${s(p * 100)}%">` + c + "</radialGradient>"
      );
    } else {
      const l = t.angle % 360 * Math.PI / 180, h = s(50 - 50 * Math.cos(l)), $ = s(50 - 50 * Math.sin(l)), f = s(50 + 50 * Math.cos(l)), p = s(50 + 50 * Math.sin(l));
      e.push(
        `<linearGradient id="${a}" x1="${h}%" y1="${$}%" x2="${f}%" y2="${p}%">` + c + "</linearGradient>"
      );
    }
    return `<rect width="${r}" height="${i}" fill="url(#${a})"/>`;
  }
  if (t.type === "picture") {
    const a = t.alpha !== void 0 && t.alpha < 1 ? ` opacity="${s(t.alpha)}"` : "";
    return `<image href="${Q(t.src)}" x="0" y="0" width="${r}" height="${i}" preserveAspectRatio="xMidYMid slice"${a}/>`;
  }
  return `<rect width="${r}" height="${i}" fill="#FFFFFF"/>`;
}
var S = (t, o) => `<rect width="${o}" height="${o}" fill="${t}"/>`;
function N(t) {
  return (o, e, n) => {
    const i = n * n * (t / 100), a = Math.max(0.3, Math.sqrt(i / Math.PI));
    return S(e, n) + `<circle cx="${n / 2}" cy="${n / 2}" r="${a.toFixed(3)}" fill="${o}"/>`;
  };
}
function ft2(t, o = 1) {
  return (e, n, r) => {
    const i = r / o, a = i * t;
    let c = "";
    for (let l = 0; l < o; l++)
      c += `<rect x="0" y="${l * i}" width="${r}" height="${a.toFixed(3)}" fill="${e}"/>`;
    return S(n, r) + c;
  };
}
function yt2(t, o = 1) {
  return (e, n, r) => {
    const i = r / o, a = i * t;
    let c = "";
    for (let l = 0; l < o; l++)
      c += `<rect x="${l * i}" y="0" width="${a.toFixed(3)}" height="${r}" fill="${e}"/>`;
    return S(n, r) + c;
  };
}
function Y(t, o) {
  return (e, n, r) => {
    const i = t ? `M0,${r} L${r},0` : `M0,0 L${r},${r}`;
    return S(n, r) + `<path d="${i}" stroke="${e}" stroke-width="${o}" fill="none"/><path d="${t ? `M-${r / 2},${r / 2} L${r / 2},-${r / 2}` : `M${r / 2},${r * 1.5} L${r * 1.5},${r / 2}`}" stroke="${e}" stroke-width="${o}" fill="none"/>`;
  };
}
var ce2 = (t, o, e) => {
  const n = e / 2;
  return S(o, e) + `<path d="M${n},0 L${e},${n} L${n},${e} L0,${n} Z" fill="${t}"/>`;
};
var ae2 = (t, o, e) => {
  const n = e / 2;
  return S(o, e) + `<path d="M${n},0 L${e},${n} L${n},${e} L0,${n} Z" fill="none" stroke="${t}" stroke-width="1"/>`;
};
var le2 = (t, o, e) => {
  const n = e / 2;
  return S(o, e) + `<circle cx="${n}" cy="${n}" r="1" fill="${t}"/><circle cx="0" cy="0" r="1" fill="${t}"/><circle cx="${e}" cy="0" r="1" fill="${t}"/><circle cx="0" cy="${e}" r="1" fill="${t}"/><circle cx="${e}" cy="${e}" r="1" fill="${t}"/>`;
};
var Ot2 = (t, o, e) => {
  const n = Math.max(1, e * 0.1);
  return S(o, e) + `<rect x="0" y="${e / 2 - n / 2}" width="${e}" height="${n}" fill="${t}"/><rect x="${e / 2 - n / 2}" y="0" width="${n}" height="${e}" fill="${t}"/>`;
};
var Rt2 = (t, o, e) => S(o, e) + `<path d="M0,0 L${e},${e} M0,${e} L${e},0" stroke="${t}" stroke-width="1" fill="none"/>`;
var he2 = (t, o, e) => S(o, e) + `<circle cx="0" cy="0" r="0.8" fill="${t}"/><circle cx="${e}" cy="0" r="0.8" fill="${t}"/><circle cx="0" cy="${e}" r="0.8" fill="${t}"/><circle cx="${e}" cy="${e}" r="0.8" fill="${t}"/>`;
function _t2(t) {
  return (o, e, n) => {
    const r = n / t;
    let i = "";
    for (let a = 0; a < t; a++)
      for (let c = 0; c < t; c++)
        (a + c) % 2 === 0 && (i += `<rect x="${a * r}" y="${c * r}" width="${r}" height="${r}" fill="${o}"/>`);
    return S(e, n) + i;
  };
}
var $e2 = {
  pct5: N(5),
  pct10: N(10),
  pct20: N(20),
  pct25: N(25),
  pct30: N(30),
  pct40: N(40),
  pct50: N(50),
  pct60: N(60),
  pct70: N(70),
  pct75: N(75),
  pct80: N(80),
  pct90: N(90),
  horz: ft2(0.25),
  vert: yt2(0.25),
  ltHorz: ft2(0.15, 2),
  ltVert: yt2(0.15, 2),
  dkHorz: ft2(0.4),
  dkVert: yt2(0.4),
  narHorz: ft2(0.1, 3),
  narVert: yt2(0.1, 3),
  dashHorz: (t, o, e) => S(o, e) + `<path d="M0,${e / 2} L${e / 2},${e / 2}" stroke="${t}" stroke-width="${e * 0.15}" fill="none"/>`,
  dashVert: (t, o, e) => S(o, e) + `<path d="M${e / 2},0 L${e / 2},${e / 2}" stroke="${t}" stroke-width="${e * 0.15}" fill="none"/>`,
  cross: Ot2,
  diagCross: Rt2,
  dnDiag: Y(false, 1),
  upDiag: Y(true, 1),
  ltDnDiag: Y(false, 0.7),
  ltUpDiag: Y(true, 0.7),
  dkDnDiag: Y(false, 2),
  dkUpDiag: Y(true, 2),
  wdDnDiag: Y(false, 3),
  wdUpDiag: Y(true, 3),
  dashDnDiag: (t, o, e) => S(o, e) + `<path d="M0,0 L${e / 2},${e / 2}" stroke="${t}" stroke-width="1" fill="none"/>`,
  dashUpDiag: (t, o, e) => S(o, e) + `<path d="M0,${e} L${e / 2},${e / 2}" stroke="${t}" stroke-width="1" fill="none"/>`,
  smCheck: _t2(4),
  lgCheck: _t2(2),
  smGrid: (t, o, e) => S(o, e) + `<path d="M0,0 L${e},0 M0,0 L0,${e}" stroke="${t}" stroke-width="0.5" fill="none"/>`,
  lgGrid: (t, o, e) => S(o, e) + `<path d="M0,0 L${e},0 M0,0 L0,${e}" stroke="${t}" stroke-width="1.5" fill="none"/>`,
  dotGrid: he2,
  smConfetti: N(15),
  lgConfetti: N(30),
  solidDmnd: ce2,
  openDmnd: ae2,
  dotDmnd: le2,
  // Less common — approximations
  plaid: (t, o, e) => S(o, e) + `<rect x="0" y="${e / 2}" width="${e}" height="1" fill="${t}"/><rect x="${e / 2}" y="0" width="1" height="${e}" fill="${t}"/>`,
  sphere: (t, o, e) => S(o, e) + `<circle cx="${e / 2}" cy="${e / 2}" r="${e * 0.35}" fill="${t}"/>`,
  weave: Ot2,
  divot: (t, o, e) => S(o, e) + `<path d="M0,${e / 2} Q${e / 4},0 ${e / 2},${e / 2} T${e},${e / 2}" stroke="${t}" stroke-width="1" fill="none"/>`,
  shingle: ft2(0.5, 2),
  wave: (t, o, e) => S(o, e) + `<path d="M0,${e / 2} Q${e / 4},${e / 4} ${e / 2},${e / 2} T${e},${e / 2}" stroke="${t}" stroke-width="1" fill="none"/>`,
  trellis: Rt2,
  zigZag: (t, o, e) => S(o, e) + `<path d="M0,${e / 2} L${e / 4},0 L${e / 2},${e / 2} L${e * 3 / 4},0 L${e},${e / 2}" stroke="${t}" stroke-width="1" fill="none"/>`,
  horzBrick: (t, o, e) => S(o, e) + `<path d="M0,${e / 2} L${e},${e / 2} M0,0 L0,${e / 2} M${e / 2},${e / 2} L${e / 2},${e}" stroke="${t}" stroke-width="1" fill="none"/>`,
  diagBrick: (t, o, e) => S(o, e) + `<path d="M0,${e / 2} L${e},${e / 2} M0,0 L${e / 2},${e / 2} M${e / 2},${e / 2} L${e},${e}" stroke="${t}" stroke-width="1" fill="none"/>`
};
var fe2 = 8;
function vt2(t) {
  if (t.alpha < 1) {
    const o = Math.round(t.alpha * 255).toString(16).padStart(2, "0").toUpperCase();
    return t.hex + o;
  }
  return t.hex;
}
function de2(t, o) {
  if (!t || t.type === "none")
    return { attr: 'fill="none"' };
  if (t.type === "solid") {
    const e = vt2(t.color);
    return t.color.alpha < 1 && t.color.alpha > 0 ? {
      attr: `fill="${t.color.hex}" fill-opacity="${s(t.color.alpha)}"`
    } : { attr: `fill="${e}"` };
  }
  if (t.type === "gradient") {
    const e = o();
    if (t.gradientType === "linear") {
      const n = t.angle % 360 * Math.PI / 180, r = s(50 - 50 * Math.cos(n)), i = s(50 - 50 * Math.sin(n)), a = s(50 + 50 * Math.cos(n)), c = s(50 + 50 * Math.sin(n)), l = t.stops.map(($) => {
        const f = $.color.alpha < 1 ? ` stop-opacity="${s($.color.alpha)}"` : "";
        return `<stop offset="${s($.position * 100)}%" stop-color="${$.color.hex}"${f}/>`;
      }).join(""), h = `<linearGradient id="${e}" x1="${r}%" y1="${i}%" x2="${a}%" y2="${c}%">` + l + "</linearGradient>";
      return { attr: `fill="url(#${e})"`, defs: h };
    }
    if (t.gradientType === "radial") {
      const n = t.stops.map(($) => {
        const f = $.color.alpha < 1 ? ` stop-opacity="${s($.color.alpha)}"` : "";
        return `<stop offset="${s($.position * 100)}%" stop-color="${$.color.hex}"${f}/>`;
      }).join(""), { cx: r, cy: i, r: a, fx: c, fy: l } = Tt2(t.fillToRect), h = `<radialGradient id="${e}" cx="${s(r * 100)}%" cy="${s(i * 100)}%" r="${s(a * 100)}%" fx="${s(c * 100)}%" fy="${s(l * 100)}%">` + n + "</radialGradient>";
      return { attr: `fill="url(#${e})"`, defs: h };
    }
  }
  if (t.type === "pattern") {
    const e = o(), n = $e2[t.preset], r = fe2, i = vt2(t.fgColor), a = vt2(t.bgColor), c = n ? n(i, a, r) : `<rect width="${r}" height="${r}" fill="${i}"/>`, l = `<pattern id="${e}" patternUnits="userSpaceOnUse" width="${r}" height="${r}">` + c + "</pattern>";
    return { attr: `fill="url(#${e})"`, defs: l };
  }
  if (t.type === "picture") {
    const e = o(), n = t.alpha !== void 0 && t.alpha < 1 ? ` opacity="${s(t.alpha)}"` : "";
    if (t.tile && t.tile.tileWidth && t.tile.tileHeight) {
      const i = s(d(t.tile.tileWidth)), a = s(d(t.tile.tileHeight)), c = s(d(t.tile.offsetX)), l = s(d(t.tile.offsetY)), h = t.tile.offsetX !== 0 || t.tile.offsetY !== 0 ? ` patternTransform="translate(${c} ${l})"` : "", $ = `<pattern id="${e}" patternUnits="userSpaceOnUse" width="${i}" height="${a}"${h}><image href="${t.src}" width="${i}" height="${a}" preserveAspectRatio="none"${n}/></pattern>`;
      return { attr: `fill="url(#${e})"`, defs: $ };
    }
    const r = `<pattern id="${e}" patternUnits="objectBoundingBox" width="1" height="1"><image href="${t.src}" width="100%" height="100%" preserveAspectRatio="${t.stretch ? "none" : "xMidYMid slice"}"${n}/></pattern>`;
    return { attr: `fill="url(#${e})"`, defs: r };
  }
  return { attr: 'fill="none"' };
}
function ue2(t) {
  if (!t || t.type === "none") return "transparent";
  if (t.type === "solid") {
    if (t.color.alpha < 1) {
      const o = parseInt(t.color.hex.slice(1, 3), 16), e = parseInt(t.color.hex.slice(3, 5), 16), n = parseInt(t.color.hex.slice(5, 7), 16);
      return `rgba(${o},${e},${n},${t.color.alpha})`;
    }
    return t.color.hex;
  }
  if (t.type === "gradient") {
    const o = t.stops.map((r) => `${r.color.hex} ${s(r.position * 100)}%`).join(", ");
    if (t.gradientType === "linear")
      return `linear-gradient(${t.angle}deg, ${o})`;
    const { cx: e, cy: n } = Tt2(t.fillToRect);
    return `radial-gradient(circle at ${s(e * 100)}% ${s(n * 100)}%, ${o})`;
  }
  return t.type === "picture" ? `url(${t.src}) center/cover no-repeat` : t.type === "pattern" ? t.fgColor.hex : "transparent";
}
var pe2 = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F]/;
function pt2(t, o) {
  const e = [], n = /* @__PURE__ */ new Set();
  for (const r of t) {
    if (n.has(r)) continue;
    n.add(r), e.push(`'${r}'`);
    const i = o == null ? void 0 : o[r];
    i && !n.has(i) && (n.add(i), e.push(`'${i}'`));
  }
  return e.push("sans-serif"), e.join(", ");
}
function ge2(t, o, e, n) {
  return o && o !== t ? pe2.test(e) ? pt2([o, t], n) : pt2([t, o], n) : pt2([t], n);
}
function Lt2(t) {
  if (t.alpha < 1) {
    const o = parseInt(t.hex.slice(1, 3), 16), e = parseInt(t.hex.slice(3, 5), 16), n = parseInt(t.hex.slice(5, 7), 16);
    return `rgba(${o},${e},${n},${t.alpha})`;
  }
  return t.hex;
}
function Ut2(t) {
  return t.unit === "pt" ? `${s(d(t.value))}px` : `${s(t.value / 100 * 1.2)}em`;
}
function tt2(t, o) {
  const e = [1e3, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1], n = ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"];
  let r = "";
  for (let i = 0; i < e.length; i++)
    for (; t >= e[i]; )
      r += n[i], t -= e[i];
  return o ? r : r.toLowerCase();
}
function et2(t, o) {
  let e = "";
  for (; t > 0; )
    t--, e = String.fromCharCode(t % 26 + (o ? 65 : 97)) + e, t = Math.floor(t / 26);
  return e;
}
function Wt2(t) {
  return String(t).replace(/\d/g, (o) => String.fromCharCode(65296 + Number(o)));
}
var dt2 = ["\u96F6", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u4E03", "\u516B", "\u4E5D"];
function K2(t) {
  if (t <= 0) return dt2[0];
  if (t < 10) return dt2[t];
  if (t === 10) return "\u5341";
  if (t < 20) return "\u5341" + dt2[t - 10];
  if (t < 100) {
    const o = Math.floor(t / 10), e = t % 10;
    return dt2[o] + "\u5341" + (e === 0 ? "" : dt2[e]);
  }
  return String(t);
}
function Kt2(t) {
  return t >= 1 && t <= 20 ? String.fromCharCode(9312 + t - 1) : `(${t})`;
}
function ye2(t) {
  return t >= 1 && t <= 10 ? String.fromCharCode(10102 + t - 1) : t >= 11 && t <= 20 ? String.fromCharCode(9451 + t - 11) : `(${t})`;
}
function xe2(t) {
  return t >= 1 && t <= 10 ? String.fromCharCode(9461 + t - 1) : Kt2(t);
}
function we2(t, o) {
  switch (o) {
    // Roman
    case "romanUcPeriod":
      return `${tt2(t, true)}.`;
    case "romanLcPeriod":
      return `${tt2(t, false)}.`;
    case "romanUcParenR":
      return `${tt2(t, true)})`;
    case "romanLcParenR":
      return `${tt2(t, false)})`;
    case "romanUcParenBoth":
      return `(${tt2(t, true)})`;
    case "romanLcParenBoth":
      return `(${tt2(t, false)})`;
    // Latin alpha
    case "alphaUcPeriod":
      return `${et2(t, true)}.`;
    case "alphaLcPeriod":
      return `${et2(t, false)}.`;
    case "alphaUcParenR":
      return `${et2(t, true)})`;
    case "alphaLcParenR":
      return `${et2(t, false)})`;
    case "alphaUcParenBoth":
      return `(${et2(t, true)})`;
    case "alphaLcParenBoth":
      return `(${et2(t, false)})`;
    // Arabic
    case "arabicParenR":
      return `${t})`;
    case "arabicParenBoth":
      return `(${t})`;
    case "arabicPlain":
      return `${t}`;
    case "arabic1Minus":
      return `${t}-`;
    case "arabic2Minus":
      return `${t}-`;
    case "arabicDbPeriod":
      return `${Wt2(t)}\uFF0E`;
    case "arabicDbPlain":
      return Wt2(t);
    // CJK circled
    case "circleNumDbPlain":
      return Kt2(t);
    case "circleNumWdBlackPlain":
      return ye2(t);
    case "circleNumWdWhitePlain":
      return xe2(t);
    // CJK (Chinese/Traditional/Korean) numeric schemes
    case "ea1ChsPeriod":
      return `${K2(t)}\u3001`;
    case "ea1ChsPlain":
      return K2(t);
    case "ea1ChtPeriod":
      return `${K2(t)}\u3001`;
    case "ea1ChtPlain":
      return K2(t);
    case "ea1JpnChsDbPeriod":
      return `${K2(t)}\uFF0E`;
    case "ea1JpnKorPeriod":
      return `${K2(t)}\uFF0E`;
    case "ea1JpnKorPlain":
      return K2(t);
    // Hebrew / Thai / Hindi — fall back to arabic with the bracket style
    case "hebrew2Minus":
      return `${t}-`;
    case "thaiAlphaPeriod":
    case "thaiNumPeriod":
    case "hindiAlphaPeriod":
    case "hindiAlpha1Period":
    case "hindiNumPeriod":
      return `${t}.`;
    case "thaiAlphaParenR":
    case "thaiNumParenR":
    case "hindiNumParenR":
      return `${t})`;
    case "thaiAlphaParenBoth":
    case "thaiNumParenBoth":
      return `(${t})`;
    case "arabicPeriod":
    default:
      return `${t}.`;
  }
}
function me2(t, o, e) {
  const n = t.properties, r = ge2(n.fontFamily, n.eaFontFamily, t.text, o), i = e ? n.fontSize * e : n.fontSize, a = {
    "font-family": r,
    "font-size": `${s(d(i))}px`,
    color: n.color ? Lt2(n.color) : "inherit"
  };
  n.bold && (a["font-weight"] = "bold"), n.italic && (a["font-style"] = "italic");
  const c = [];
  n.underline === "single" && c.push("underline"), n.underline === "double" && c.push("underline"), n.strikethrough && c.push("line-through"), c.length > 0 && (a["text-decoration"] = c.join(" ")), n.letterSpacing && (a["letter-spacing"] = `${s(d(n.letterSpacing))}px`), n.baseline && n.baseline !== 0 && (n.baseline > 0 ? (a["vertical-align"] = "super", a["font-size"] = `${s(d(i * 0.65))}px`) : (a["vertical-align"] = "sub", a["font-size"] = `${s(d(i * 0.65))}px`));
  const l = J(a), h = At2(t.text).replace(/\n/g, "<br/>");
  return `<span style="${l}">${h}</span>`;
}
function Gt2(t) {
  const o = t.properties.bullet;
  if (o) {
    if (o.fontSize) return o.fontSize;
    if (o.fontSizePercent && t.runs.length > 0)
      return t.runs[0].properties.fontSize * o.fontSizePercent;
  }
}
function be2(t, o, e) {
  const n = t.properties.bullet;
  if (!n) return "";
  if (n.type === "char" && n.char) {
    const r = {};
    n.color && (r.color = Lt2(n.color)), n.fontFamily && (r["font-family"] = pt2([n.fontFamily], e));
    const i = Gt2(t);
    i && (r["font-size"] = `${s(d(i))}px`);
    const a = J(r);
    return `<span${a ? ` style="${a}"` : ""}>${At2(n.char)}</span> `;
  }
  if (n.type === "number") {
    const r = o ?? n.startAt ?? 1, i = {};
    n.color && (i.color = Lt2(n.color)), n.fontFamily && (i["font-family"] = pt2([n.fontFamily], e));
    const a = Gt2(t);
    a && (i["font-size"] = `${s(d(a))}px`);
    const c = J(i);
    return `<span${c ? ` style="${c}"` : ""}>${we2(r, n.numberType)}</span> `;
  }
  return "";
}
function Xt2(t, o, e, n, r, i, a) {
  const c = t.properties, l = {
    "text-align": c.alignment,
    margin: "0",
    padding: "0"
  };
  if (c.lineSpacing)
    if (c.lineSpacing.unit === "percent") {
      let x = c.lineSpacing.value / 100;
      r && (x = Math.max(0.5, x - r)), l["line-height"] = String(s(x));
    } else {
      const x = Math.max(1, c.lineSpacing.value);
      l["line-height"] = `${s(d(x))}px`;
    }
  else r && (l["line-height"] = String(s(Math.max(0.5, 1 - r))));
  c.spaceBefore && (l["margin-top"] = Ut2(c.spaceBefore)), c.spaceAfter && (l["margin-bottom"] = Ut2(c.spaceAfter)), c.indent && (l["text-indent"] = `${s(d(c.indent))}px`), c.marginLeft && (l["margin-left"] = `${s(d(c.marginLeft))}px`), c.level > 0 && !c.marginLeft && (l["margin-left"] = `${s(d(c.level * 18))}px`);
  const h = J(l), $ = be2(t, o, e), p = t.runs.map((x) => me2(x, e, n)).join("") || "&nbsp;";
  return `<p${i !== void 0 ? ` data-pagus-p-idx="${i}"` : ""} style="${a ? "visibility:hidden;" : ""}${h}">${$}${p}</p>`;
}
function qt2(t, o, e, n, r) {
  const i = {};
  return t.map((a, c) => {
    const l = a.properties.bullet, h = a.properties.level, $ = r == null ? void 0 : r.has(c);
    if ((l == null ? void 0 : l.type) === "number") {
      i[h] === void 0 ? i[h] = l.startAt ?? 1 : i[h]++;
      for (const f of Object.keys(i))
        Number(f) > h && delete i[Number(f)];
      return Xt2(a, i[h], o, e, n, c, $);
    }
    return delete i[h], Xt2(a, void 0, o, e, n, c, $);
  }).join("");
}
function Se2(t, o, e, n) {
  const { bodyProperties: r, paragraphs: i } = t, { anchor: a, margins: c } = r, l = r.fontScale, h = r.lnSpcReduction, $ = d(o.width), f = d(o.height), p = s(d(c.top)), u = s(d(c.right)), y2 = s(d(c.bottom)), x = s(d(c.left)), g = qt2(i, e, l, h, n), F = r.autoFit === "resize", b = r.autoFit === "shrink" && !l, D = F || b ? 0 : f * 9;
  let A, w2, M;
  F ? (A = 0, w2 = f * 10, M = "flex-start") : b ? (A = 0, w2 = f, M = a === "bottom" ? "flex-end" : a === "middle" ? "center" : "flex-start") : a === "bottom" ? (A = -D, w2 = f + D, M = "flex-end") : a === "top" ? (A = 0, w2 = f + D, M = "flex-start") : (A = -D / 2, w2 = f + D, M = "center");
  const j = J({
    display: "flex",
    "flex-direction": "column",
    "justify-content": M,
    width: "100%",
    height: F ? "auto" : "100%",
    padding: `${p}px ${u}px ${y2}px ${x}px`,
    "box-sizing": "border-box",
    overflow: "visible",
    // Match Office Online's default: hardcoded 1.2 when no explicit lnSpc.
    // PowerPoint's "single spacing" derives from OS/2 sTypoAscender +
    // sTypoDescender (YaHei ≈ 1.14em, typical Latin ≈ 1.15em), but that
    // requires font-metric introspection. Office sidesteps by fixing 1.2
    // for cross-font consistency — we follow that choice. CSS `normal`
    // reads hhea + lineGap (YaHei renders ~1.3em, noticeably looser than
    // PowerPoint); `1` is too tight for every font. Explicit spcPct/spcPts
    // overrides.
    "line-height": "1.2",
    "white-space": r.wrap === "none" ? "nowrap" : "normal",
    "word-wrap": "break-word"
  }), U2 = b ? ' data-pagus-shrink-fit="1"' : "";
  return [
    `<foreignObject x="0" y="${s(A)}" width="${s($)}" height="${s(w2)}" overflow="visible">`,
    `<div xmlns="http://www.w3.org/1999/xhtml"${U2} style="${j}">`,
    g,
    "</div>",
    "</foreignObject>"
  ].join("");
}
function Me2(t, o) {
  const { bodyProperties: e, paragraphs: n } = t, { anchor: r, margins: i } = e, a = r === "top" ? "flex-start" : r === "bottom" ? "flex-end" : "center", c = s(d(i.top)), l = s(d(i.right)), h = s(d(i.bottom)), $ = s(d(i.left)), f = qt2(n, o, e.fontScale, e.lnSpcReduction);
  return `<div style="${J({
    display: "flex",
    "flex-direction": "column",
    "justify-content": a,
    width: "100%",
    height: "100%",
    padding: `${c}px ${l}px ${h}px ${$}px`,
    "box-sizing": "border-box",
    overflow: "hidden"
  })}">${f}</div>`;
}
var Yt2 = { small: 3, medium: 5, large: 8 };
function Vt2(t, o, e, n, r) {
  const i = n(), a = Yt2[t.width] ?? 5, c = Yt2[t.length] ?? 5;
  if (t.type === "arrow") {
    const h = `M0,0 L${a},${c / 2} L0,${c}`;
    return r.push(
      `<marker id="${i}" viewBox="0 0 ${a} ${c}" refX="${a}" refY="${c / 2}" markerWidth="${a}" markerHeight="${c}" orient="auto-start-reverse"><path d="${h}" fill="none" stroke="${o}" stroke-width="1"/></marker>`
    ), i;
  }
  let l;
  switch (t.type) {
    case "triangle":
      l = `M0,0 L${a},${c / 2} L0,${c} Z`;
      break;
    case "stealth":
      l = `M0,0 L${a},${c / 2} L0,${c} L${a * 0.3},${c / 2} Z`;
      break;
    case "oval":
      l = `M${a / 2},0 A${a / 2},${c / 2} 0 1,1 ${a / 2},${c} A${a / 2},${c / 2} 0 1,1 ${a / 2},0 Z`;
      break;
    case "diamond":
      l = `M0,${c / 2} L${a / 2},0 L${a},${c / 2} L${a / 2},${c} Z`;
      break;
    default:
      l = `M0,0 L${a},${c / 2} L0,${c} Z`;
  }
  return r.push(
    `<marker id="${i}" viewBox="0 0 ${a} ${c}" refX="${a}" refY="${c / 2}" markerWidth="${a}" markerHeight="${c}" orient="auto-start-reverse"><path d="${l}" fill="${o}"/></marker>`
  ), i;
}
function Fe2(t) {
  var c, l;
  if (!((c = t.transform) != null && c.flipH) && !((l = t.transform) != null && l.flipV)) return null;
  const o = d(t.size.width), e = d(t.size.height), n = s(o / 2), r = s(e / 2), i = t.transform.flipH ? -1 : 1, a = t.transform.flipV ? -1 : 1;
  return `translate(${n},${r}) scale(${i},${a}) translate(-${n},-${r})`;
}
function Ce2(t, o, e, n, r) {
  const i = t.size.width, a = t.size.height, c = d(i), l = d(a), h = Wx(t.geometry, c, l), $ = de2(t.fill, e);
  $.defs && o.push($.defs);
  let f = "";
  if (t.stroke) {
    const g = t.stroke, F = s(d(g.width));
    f = ` stroke="${g.color.hex}"`, g.color.alpha < 1 && (f += ` stroke-opacity="${s(g.color.alpha)}"`), f += ` stroke-width="${F}"`, f += ` stroke-linejoin="${g.lineJoin}"`;
    const b = ie2(g.dashStyle, d(g.width));
    if (b && (f += ` stroke-dasharray="${b}"`), g.headEnd) {
      const m = Vt2(g.headEnd, g.color.hex, d(g.width), e, o);
      f += ` marker-start="url(#${m})"`;
    }
    if (g.tailEnd) {
      const m = Vt2(g.tailEnd, g.color.hex, d(g.width), e, o);
      f += ` marker-end="url(#${m})"`;
    }
  } else
    f = ' stroke="none"';
  const p = t.geometry.kind === "preset" && t.geometry.preset === "line", u = Fe2(t);
  let y2;
  u ? y2 = `<g transform="${u}"><path d="${h}" ${$.attr}${f}/></g>` : y2 = `<path d="${h}" ${$.attr}${f}/>`;
  let x = "";
  return t.textBody && t.textBody.paragraphs.length > 0 && (x = Se2(t.textBody, t.size, n, r)), x || p ? `<g>${y2}${x}</g>` : y2;
}
function ke2(t, o, e) {
  var c, l;
  const n = d(t.size.width), r = d(t.size.height), i = t.alpha !== void 0 && t.alpha < 1 ? ` opacity="${s(t.alpha)}"` : "";
  let a;
  if (t.crop) {
    const { top: h, right: $, bottom: f, left: p } = t.crop, u = e(), y2 = 1 - p - $, x = 1 - h - f, g = y2 > 0 ? n / y2 : n, F = x > 0 ? r / x : r, b = -g * p, m = -F * h;
    o.push(
      `<clipPath id="${u}"><rect x="0" y="0" width="${s(n)}" height="${s(r)}"/></clipPath>`
    ), a = `<image href="${Q(t.src)}" x="${s(b)}" y="${s(m)}" width="${s(g)}" height="${s(F)}" preserveAspectRatio="none" clip-path="url(#${u})"${i}/>`;
  } else
    a = `<image href="${Q(t.src)}" x="0" y="0" width="${s(n)}" height="${s(r)}" preserveAspectRatio="none"${i}/>`;
  if ((c = t.transform) != null && c.flipH || (l = t.transform) != null && l.flipV) {
    const h = s(n / 2), $ = s(r / 2), f = t.transform.flipH ? -1 : 1, p = t.transform.flipV ? -1 : 1;
    return `<g transform="translate(${h},${$}) scale(${f},${p}) translate(-${h},-${$})">${a}</g>`;
  }
  return a;
}
function Pe2(t) {
  const o = d(t.size.width), e = d(t.size.height);
  if (t.mediaType === "video") {
    const a = t.posterSrc ? ` poster="${Q(t.posterSrc)}"` : "", c = `<video controls preload="metadata" playsinline style="width:100%;height:100%;object-fit:contain;background:#000" src="${Q(t.src)}"${a}></video>`;
    return `<foreignObject x="0" y="0" width="${s(o)}" height="${s(e)}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%">${c}</div></foreignObject>`;
  }
  const n = t.posterSrc ? `<image href="${Q(t.posterSrc)}" x="0" y="0" width="${s(o)}" height="${s(e)}" preserveAspectRatio="xMidYMid meet"/>` : "", r = Math.min(40, e), i = `<foreignObject x="0" y="${s(e - r)}" width="${s(o)}" height="${s(r)}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%"><audio controls preload="metadata" style="width:100%" src="${Q(t.src)}"></audio></div></foreignObject>`;
  return n + i;
}
function ve2(t, o) {
  const e = t.startsWith("#") ? t.slice(1) : t, n = Math.round(255 - (255 - parseInt(e.slice(0, 2), 16)) * o), r = Math.round(255 - (255 - parseInt(e.slice(2, 4), 16)) * o), i = Math.round(255 - (255 - parseInt(e.slice(4, 6), 16)) * o);
  return `rgb(${n},${r},${i})`;
}
function xt2(t) {
  if (!t) return "none";
  const o = s(d(t.width));
  let e = "solid";
  t.style === "dashed" ? e = "dashed" : t.style === "dotted" && (e = "dotted");
  let n = t.color.hex;
  if (t.color.alpha < 1) {
    const r = parseInt(n.slice(1, 3), 16), i = parseInt(n.slice(3, 5), 16), a = parseInt(n.slice(5, 7), 16);
    n = `rgba(${r},${i},${a},${t.color.alpha})`;
  }
  return `${o}px ${e} ${n}`;
}
function Le2(t, o, e, n, r) {
  if (t.isMerged) return "";
  const a = {
    background: t.fill ? ue2(t.fill) : n == null ? void 0 : n.defaultBg,
    overflow: "hidden",
    "vertical-align": "top",
    padding: "0"
  };
  n != null && n.defaultColor && (a.color = n.defaultColor), t.borders && (a["border-top"] = xt2(t.borders.top), a["border-right"] = xt2(t.borders.right), a["border-bottom"] = xt2(t.borders.bottom), a["border-left"] = xt2(t.borders.left));
  const l = [`style="${J(a)}"`];
  t.colSpan > 1 && l.push(`colspan="${t.colSpan}"`), t.rowSpan > 1 && l.push(`rowspan="${t.rowSpan}"`);
  const h = t.textBody ? Me2(t.textBody, r) : "";
  return `<td ${l.join(" ")}>${h}</td>`;
}
function Ae2(t, o) {
  const e = d(t.size.width), n = d(t.size.height), r = t.grid.colWidths.map(d), i = t.grid.rowHeights.map(d), a = "<colgroup>" + r.map((f) => `<col style="width:${s(f)}px"/>`).join("") + "</colgroup>", c = t.tableStyle, l = c == null ? void 0 : c.accentColor, h = t.rows.map((f, p) => {
    const u = i[p] ?? 0;
    let y2;
    c && l && (c.firstRow && p === 0 ? y2 = { defaultBg: l, defaultColor: "#FFFFFF" } : c.bandRow && (c.firstRow ? p - 1 : p) % 2 === 0 && (y2 = { defaultBg: ve2(l, 0.2) }));
    const x = f.cells.map((g, F) => {
      const b = r[F] ?? 0;
      return Le2(g, b, u, y2, o);
    }).filter(Boolean).join("");
    return `<tr style="height:${s(u)}px">${x}</tr>`;
  }).join(""), $ = J({
    "border-collapse": "collapse",
    width: `${s(e)}px`,
    height: `${s(n)}px`,
    "table-layout": "fixed"
  });
  return [
    `<foreignObject x="0" y="0" width="${s(e)}" height="${s(n)}">`,
    `<table xmlns="http://www.w3.org/1999/xhtml" style="${$}">`,
    a,
    "<tbody>",
    h,
    "</tbody>",
    "</table>",
    "</foreignObject>"
  ].join("");
}
var Jt2 = [
  "#4472C4",
  "#ED7D31",
  "#A5A5A5",
  "#FFC000",
  "#5B9BD5",
  "#70AD47",
  "#264478",
  "#9E480E",
  "#636363",
  "#997300",
  "#255E91",
  "#43682B"
];
var W2 = "#595959";
var mt2 = "#d9d9d9";
var Qt2 = "#e6e6e6";
var V2 = 10;
function Dt2(t, o) {
  var n;
  if (!o || o === "General")
    return Number.isInteger(t) ? String(t) : String(Number(t.toFixed(4)));
  if (o.includes("%")) {
    const r = ((n = o.match(/0\.(0+)/)) == null ? void 0 : n[1].length) ?? 0;
    return `${(t * 100).toFixed(r)}%`;
  }
  const e = o.match(/0\.(0+)/);
  return e ? t.toFixed(e[1].length) : o.includes("0") ? Math.round(t).toString() : String(t);
}
function Ft2(t, o) {
  return t.color ?? Jt2[o % Jt2.length];
}
function zt2(t, o, e) {
  var n;
  return ((n = t.dataPoints[o]) == null ? void 0 : n.color) ?? Ft2(t, e);
}
function bt2(t, o, e, n, r) {
  const i = [];
  return t.showSeriesName && n && i.push(n), t.showCategory && e && i.push(e), t.showValue && i.push(Dt2(o, t.numFmt)), t.showPercent && r !== void 0 && i.push(`${Math.round(r * 100)}%`), i.join(" ");
}
function I(t, o, e, n = {}) {
  if (!e) return "";
  const r = n.size ?? V2, i = n.color ?? W2, a = n.anchor ?? "middle", c = n.dominantBaseline ?? "central", l = n.bold ? "bold" : "normal", h = d(r);
  return `<text x="${s(t)}" y="${s(o)}" font-size="${s(h)}" fill="${i}" text-anchor="${a}" dominant-baseline="${c}" font-weight="${l}" font-family="sans-serif">${At2(e)}</text>`;
}
function St2(t, o) {
  const e = d(o);
  let n = 0;
  for (const r of t)
    n += /[\u4e00-\u9fff\uff00-\uffef]/.test(r) ? e : e * 0.55;
  return n;
}
function Te2(t) {
  if (t.chartType === "pie" || t.chartType === "doughnut") {
    const o = t.series[0];
    if (!o) return [];
    const e = [], n = Math.max(t.categories.length, o.dataPoints.length);
    for (let r = 0; r < n; r++)
      e.push({
        label: t.categories[r] ?? o.name ?? "",
        color: zt2(o, r, 0)
      });
    return e;
  }
  return t.series.map((o, e) => ({
    label: o.name ?? "",
    color: Ft2(o, e)
  }));
}
function De2(t, o, e, n) {
  if (o.length === 0) return;
  const r = t.fontSize ?? 10, i = d(r) * 1.6, a = d(r) * 0.9, c = d(r) * 0.6, l = d(r) * 1.2, h = t.position ?? "r", $ = h === "t" || h === "b" ? "horizontal" : "vertical";
  if ($ === "horizontal") {
    let y2 = 0;
    for (const g of o)
      y2 += a + c + St2(g.label, r) + l;
    const x = i;
    return {
      x: Math.max(0, (e - y2) / 2),
      y: h === "t" ? 4 : n - x - 4,
      width: y2,
      height: x,
      orientation: $
    };
  }
  let f = 0;
  for (const y2 of o)
    f = Math.max(f, St2(y2.label, r));
  const p = a + c + f + l, u = o.length * i;
  return {
    x: h === "l" ? 4 : e - p - 4,
    y: Math.max(0, (n - u) / 2),
    width: p,
    height: u,
    orientation: $
  };
}
function Ne2(t, o, e) {
  const n = t.fontSize ?? 10, r = d(n) * 1.6, i = d(n) * 0.9, a = d(n) * 0.6, c = d(n) * 1.2, l = t.color ?? W2, h = [];
  if (e.orientation === "horizontal") {
    let $ = e.x;
    const f = e.y + e.height / 2;
    for (const p of o) {
      const u = f - i / 2;
      h.push(
        `<rect x="${s($)}" y="${s(u)}" width="${s(i)}" height="${s(i)}" fill="${p.color}"/>`
      ), $ += i + a, h.push(I($, f, p.label, { size: n, color: l, anchor: "start" })), $ += St2(p.label, n) + c;
    }
  } else {
    const $ = e.x;
    for (let f = 0; f < o.length; f++) {
      const p = o[f], u = e.y + f * r + r / 2, y2 = u - i / 2;
      h.push(
        `<rect x="${s($)}" y="${s(y2)}" width="${s(i)}" height="${s(i)}" fill="${p.color}"/>`
      ), h.push(
        I($ + i + a, u, p.label, { size: n, color: l, anchor: "start" })
      );
    }
  }
  return h.join("");
}
function Ee2(t, o) {
  var u;
  const e = o.x + o.width / 2, n = o.y + o.height / 2, r = Math.min(o.width, o.height) / 2 * 0.95, i = r * (t.holeSize / 100), a = t.series[0];
  if (!a) return "";
  const c = a.dataPoints.reduce((y2, x) => y2 + x.value, 0);
  if (c <= 0) return "";
  const l = ((u = t.seriesDataLabels) == null ? void 0 : u[0]) ?? t.dataLabels, h = !!l && (l.showValue || l.showPercent || l.showCategory || l.showSeriesName), $ = [], f = [];
  let p = (t.firstSliceAngle - 90) * (Math.PI / 180);
  for (let y2 = 0; y2 < a.dataPoints.length; y2++) {
    const x = a.dataPoints[y2], g = x.value / c, F = g * 2 * Math.PI, b = p + F, m = F > Math.PI ? 1 : 0, D = p + F / 2, A = e + r * Math.cos(p), w2 = n + r * Math.sin(p), M = e + r * Math.cos(b), j = n + r * Math.sin(b);
    let U2;
    if (i > 0) {
      const L = e + i * Math.cos(b), C2 = n + i * Math.sin(b), k = e + i * Math.cos(p), O = n + i * Math.sin(p);
      U2 = [
        `M${s(A)},${s(w2)}`,
        `A${s(r)},${s(r)} 0 ${m},1 ${s(M)},${s(j)}`,
        `L${s(L)},${s(C2)}`,
        `A${s(i)},${s(i)} 0 ${m},0 ${s(k)},${s(O)}`,
        "Z"
      ].join(" ");
    } else
      U2 = [
        `M${s(e)},${s(n)}`,
        `L${s(A)},${s(w2)}`,
        `A${s(r)},${s(r)} 0 ${m},1 ${s(M)},${s(j)}`,
        "Z"
      ].join(" ");
    const G2 = zt2(a, y2, 0);
    if ($.push(`<path d="${U2}" fill="${G2}" stroke="#ffffff" stroke-width="1"/>`), h && l) {
      const L = bt2(
        l,
        x.value,
        t.categories[y2],
        a.name,
        g
      );
      if (L) {
        const C2 = l.position ?? "ctr";
        let k;
        C2 === "outEnd" || C2 === "bestFit" ? k = r * 1.12 : C2 === "inEnd" ? k = i > 0 ? (i + r) / 2 : r * 0.75 : k = i > 0 ? (i + r) / 2 : r * 0.6;
        const O = e + k * Math.cos(D), nt2 = n + k * Math.sin(D);
        f.push(
          I(O, nt2, L, {
            size: l.fontSize,
            color: l.color ?? "#ffffff",
            bold: l.bold
          })
        );
      }
    }
    p = b;
  }
  return $.join("") + f.join("");
}
function te2(t, o, e = false) {
  var i;
  let n = 1 / 0, r = -1 / 0;
  if (e) {
    const a = Math.max(...t.map((c) => c.dataPoints.length));
    for (let c = 0; c < a; c++) {
      let l = 0, h = 0;
      for (const $ of t) {
        const f = ((i = $.dataPoints[c]) == null ? void 0 : i.value) ?? 0;
        f >= 0 ? l += f : h += f;
      }
      l > r && (r = l), h < n && (n = h);
    }
  } else
    for (const a of t)
      for (const c of a.dataPoints)
        c.value < n && (n = c.value), c.value > r && (r = c.value);
  return !isFinite(n) || !isFinite(r) ? { min: 0, max: 1 } : (n > 0 && (n = 0), r < 0 && (r = 0), (o == null ? void 0 : o.min) !== void 0 && (n = o.min), (o == null ? void 0 : o.max) !== void 0 && (r = o.max), n === r && (r = n + 1), { min: n, max: r });
}
function ee2(t, o, e = 5) {
  const n = o - t;
  if (n <= 0) return [t];
  const r = n / e, i = Math.pow(10, Math.floor(Math.log10(r))), a = r / i;
  let c;
  a < 1.5 ? c = i : a < 3 ? c = 2 * i : a < 7 ? c = 5 * i : c = 10 * i;
  const l = [], h = Math.ceil(t / c) * c;
  for (let $ = h; $ <= o + c * 1e-9; $ += c) {
    const f = Math.abs($) < c * 1e-9 ? 0 : Number($.toFixed(10));
    l.push(f);
  }
  return l;
}
function Ie2(t, o) {
  var Nt2, Et2;
  const e = t.chartType === "barBar", n = t.barGrouping ?? "clustered", r = n === "stacked" || n === "percentStacked", { min: i, max: a } = te2(t.series, t.valueAxis, r), c = ee2(i, a, 5), l = [], h = e ? o.x : o.y + o.height, $ = e ? o.x + o.width : o.y, f = (P) => h + ($ - h) * ((P - i) / (a - i)), p = ((Nt2 = t.valueAxis) == null ? void 0 : Nt2.gridColor) ?? Qt2;
  if (p)
    for (const P of c) {
      const T = f(P);
      e ? l.push(
        `<line x1="${s(T)}" y1="${s(o.y)}" x2="${s(T)}" y2="${s(o.y + o.height)}" stroke="${p}" stroke-width="1"/>`
      ) : l.push(
        `<line x1="${s(o.x)}" y1="${s(T)}" x2="${s(o.x + o.width)}" y2="${s(T)}" stroke="${p}" stroke-width="1"/>`
      );
    }
  const u = t.valueAxis, y2 = (u == null ? void 0 : u.labelColor) ?? W2, x = (u == null ? void 0 : u.labelFontSize) ?? V2;
  if (!(u != null && u.hidden))
    for (const P of c) {
      const T = f(P), Z = Dt2(P, u == null ? void 0 : u.numFmt);
      e ? l.push(
        I(T, o.y + o.height + d(x) * 0.8, Z, {
          size: x,
          color: y2,
          anchor: "middle"
        })
      ) : l.push(
        I(o.x - 6, T, Z, {
          size: x,
          color: y2,
          anchor: "end"
        })
      );
    }
  const g = t.categories.length || Math.max(...t.series.map((P) => P.dataPoints.length)), F = e ? o.height : o.width, b = g > 0 ? F / g : 0, m = t.categoryAxis, D = (m == null ? void 0 : m.labelColor) ?? W2, A = (m == null ? void 0 : m.labelFontSize) ?? V2, w2 = e ? o.y : o.x;
  if (!(m != null && m.hidden))
    for (let P = 0; P < g; P++) {
      const T = t.categories[P] ?? "", Z = w2 + b * (P + 0.5);
      e ? l.push(
        I(o.x - 6, Z, T, {
          size: A,
          color: D,
          anchor: "end"
        })
      ) : l.push(
        I(Z, o.y + o.height + d(A) * 0.9, T, {
          size: A,
          color: D,
          anchor: "middle"
        })
      );
    }
  const M = (m == null ? void 0 : m.lineColor) ?? mt2;
  !(m != null && m.hidden) && M && (e ? l.push(
    `<line x1="${s(o.x)}" y1="${s(o.y)}" x2="${s(o.x)}" y2="${s(o.y + o.height)}" stroke="${M}" stroke-width="1"/>`
  ) : l.push(
    `<line x1="${s(o.x)}" y1="${s(o.y + o.height)}" x2="${s(o.x + o.width)}" y2="${s(o.y + o.height)}" stroke="${M}" stroke-width="1"/>`
  ));
  const j = t.series.length, U2 = (t.gapWidth ?? 150) / 100, G2 = (t.overlap ?? 0) / 100, L = b / (1 + U2), C2 = r ? L : j > 0 ? L / (j - (j - 1) * G2) : 0, k = f(0), O = new Array(g).fill(0), nt2 = new Array(g).fill(0);
  for (let P = 0; P < j; P++) {
    const T = t.series[P], Z = Ft2(T, P), v2 = ((Et2 = t.seriesDataLabels) == null ? void 0 : Et2[P]) ?? t.dataLabels, It2 = !!v2 && (v2.showValue || v2.showCategory || v2.showPercent || v2.showSeriesName);
    for (let E = 0; E < g; E++) {
      const R = T.dataPoints[E];
      if (!R || R.value === void 0) continue;
      const jt2 = R.color ?? Z;
      let Ct2 = 0, rt2 = R.value;
      r && (R.value >= 0 ? (Ct2 = O[E], rt2 = O[E] + R.value, O[E] = rt2) : (Ct2 = nt2[E], rt2 = nt2[E] + R.value, nt2[E] = rt2));
      const it2 = f(Ct2), st2 = f(rt2), Ht2 = w2 + b * E + (b - L) / 2;
      let gt2;
      if (r ? gt2 = Ht2 : gt2 = Ht2 + C2 * P * (1 - G2), e) {
        const X = Math.min(it2, st2), z2 = Math.abs(st2 - it2), ct2 = gt2, at2 = C2;
        if (l.push(
          `<rect x="${s(X)}" y="${s(ct2)}" width="${s(z2)}" height="${s(at2)}" fill="${jt2}"/>`
        ), It2 && v2) {
          const lt2 = bt2(
            v2,
            R.value,
            t.categories[E],
            T.name,
            void 0
          );
          if (lt2) {
            const kt2 = ct2 + at2 / 2, Pt2 = v2.position ?? "ctr";
            let ht2 = X + z2 / 2, $t2 = "middle", Bt2 = v2.color ?? "#ffffff";
            Pt2 === "outEnd" && (ht2 = Math.max(it2, st2) + 4, $t2 = "start", Bt2 = v2.color ?? W2), l.push(
              I(ht2, kt2, lt2, {
                size: v2.fontSize,
                color: Bt2,
                bold: v2.bold,
                anchor: $t2
              })
            );
          }
        }
      } else {
        const X = Math.min(it2, st2), z2 = Math.abs(st2 - it2), ct2 = gt2, at2 = C2;
        if (l.push(
          `<rect x="${s(ct2)}" y="${s(X)}" width="${s(at2)}" height="${s(z2)}" fill="${jt2}"/>`
        ), It2 && v2) {
          const lt2 = bt2(
            v2,
            R.value,
            t.categories[E],
            T.name,
            void 0
          );
          if (lt2) {
            const kt2 = ct2 + at2 / 2, Pt2 = v2.position ?? "ctr";
            let ht2 = (X + (X + z2)) / 2, $t2 = v2.color ?? "#ffffff";
            Pt2 === "outEnd" && (ht2 = R.value >= 0 ? X - 4 : X + z2 + d(v2.fontSize ?? V2) * 0.9, $t2 = v2.color ?? W2), l.push(
              I(kt2, ht2, lt2, {
                size: v2.fontSize,
                color: $t2,
                bold: v2.bold,
                anchor: "middle"
              })
            );
          }
        }
      }
    }
  }
  return i < 0 && a > 0 && (e ? l.push(
    `<line x1="${s(k)}" y1="${s(o.y)}" x2="${s(k)}" y2="${s(o.y + o.height)}" stroke="${mt2}" stroke-width="1"/>`
  ) : l.push(
    `<line x1="${s(o.x)}" y1="${s(k)}" x2="${s(o.x + o.width)}" y2="${s(k)}" stroke="${mt2}" stroke-width="1"/>`
  )), l.join("");
}
function je2(t, o) {
  var D, A;
  const { min: e, max: n } = te2(t.series, t.valueAxis, false), r = ee2(e, n, 5), i = [], a = o.y + o.height, c = o.y, l = (w2) => a + (c - a) * ((w2 - e) / (n - e)), h = t.categories.length || Math.max(...t.series.map((w2) => w2.dataPoints.length)), $ = h > 0 ? o.width / h : 0, f = (w2) => o.x + $ * (w2 + 0.5), p = ((D = t.valueAxis) == null ? void 0 : D.gridColor) ?? Qt2;
  if (p)
    for (const w2 of r) {
      const M = l(w2);
      i.push(
        `<line x1="${s(o.x)}" y1="${s(M)}" x2="${s(o.x + o.width)}" y2="${s(M)}" stroke="${p}" stroke-width="1"/>`
      );
    }
  const u = t.valueAxis, y2 = (u == null ? void 0 : u.labelFontSize) ?? V2, x = (u == null ? void 0 : u.labelColor) ?? W2;
  if (!(u != null && u.hidden))
    for (const w2 of r)
      i.push(
        I(o.x - 6, l(w2), Dt2(w2, u == null ? void 0 : u.numFmt), {
          size: y2,
          color: x,
          anchor: "end"
        })
      );
  const g = t.categoryAxis, F = (g == null ? void 0 : g.labelFontSize) ?? V2, b = (g == null ? void 0 : g.labelColor) ?? W2;
  if (!(g != null && g.hidden))
    for (let w2 = 0; w2 < h; w2++)
      i.push(
        I(f(w2), o.y + o.height + d(F) * 0.9, t.categories[w2] ?? "", {
          size: F,
          color: b,
          anchor: "middle"
        })
      );
  const m = (g == null ? void 0 : g.lineColor) ?? mt2;
  !(g != null && g.hidden) && m && i.push(
    `<line x1="${s(o.x)}" y1="${s(o.y + o.height)}" x2="${s(o.x + o.width)}" y2="${s(o.y + o.height)}" stroke="${m}" stroke-width="1"/>`
  );
  for (let w2 = 0; w2 < t.series.length; w2++) {
    const M = t.series[w2], j = M.lineColor ?? Ft2(M, w2), U2 = M.lineWidth ?? 2, G2 = [];
    for (let C2 = 0; C2 < h; C2++) {
      const k = M.dataPoints[C2];
      !k || k.value === void 0 || G2.push(`${s(f(C2))},${s(l(k.value))}`);
    }
    if (G2.length < 2) continue;
    i.push(
      `<polyline points="${G2.join(" ")}" fill="none" stroke="${j}" stroke-width="${s(d(U2))}" stroke-linejoin="round" stroke-linecap="round"/>`
    );
    const L = ((A = t.seriesDataLabels) == null ? void 0 : A[w2]) ?? t.dataLabels;
    if (L && (L.showValue || L.showCategory || L.showSeriesName))
      for (let C2 = 0; C2 < h; C2++) {
        const k = M.dataPoints[C2];
        if (!k) continue;
        const O = bt2(L, k.value, t.categories[C2], M.name, void 0);
        O && i.push(
          I(f(C2), l(k.value) - 8, O, {
            size: L.fontSize,
            color: L.color ?? W2,
            bold: L.bold
          })
        );
      }
  }
  return i.join("");
}
function He2(t, o, e, n) {
  var h, $;
  let r = 0, i = 0, a = o, c = e;
  if (n && (n.orientation === "horizontal" ? (n.y < e / 2 && (i += n.height + 8), c -= n.height + 8) : (n.x < o / 2 && (r += n.width + 8), a -= n.width + 8)), t.chartType === "barCol" || t.chartType === "barBar" || t.chartType === "line") {
    const f = ((h = t.valueAxis) == null ? void 0 : h.labelFontSize) ?? V2, p = (($ = t.categoryAxis) == null ? void 0 : $.labelFontSize) ?? V2, u = t.chartType === "barBar" ? St2(
      (t.categories[0] ?? "") + "___",
      p
    ) + 8 : d(f) * 3, y2 = d(p) * 2, x = 6, g = 8;
    r += u, a -= u + g, i += x, c -= x + y2;
  } else
    r += 4, i += 4, a -= 8, c -= 8;
  return { x: r, y: i, width: Math.max(10, a), height: Math.max(10, c) };
}
function Be2(t) {
  const o = d(t.size.width), e = d(t.size.height);
  if (!t.series || t.series.length === 0) return "";
  let n, r = [];
  t.legend && (r = Te2(t).filter((c) => c.label), r.length > 0 && (n = De2(t.legend, r, o, e)));
  const i = He2(t, o, e, n), a = [];
  return t.chartType === "pie" || t.chartType === "doughnut" ? a.push(Ee2(t, i)) : t.chartType === "barCol" || t.chartType === "barBar" ? a.push(Ie2(t, i)) : t.chartType === "line" && a.push(je2(t, i)), n && t.legend && a.push(Ne2(t.legend, r, n)), a.join("");
}
function Oe2(t, o, e) {
  const n = s(d(t.position.x)), r = s(d(t.position.y)), i = [`translate(${n},${r})`];
  if (t.transform) {
    const a = d(t.size.width), c = d(t.size.height), l = s(a / 2), h = s(c / 2);
    t.transform.rotation && i.push(`rotate(${s(t.transform.rotation)},${l},${h})`);
  }
  return i.join(" ");
}
function Re2(t, o, e) {
  const n = e();
  let r = s(d(t.offsetX)), i = s(d(t.offsetY)), a = d(t.blurRadius);
  const c = parseInt(t.color.hex.slice(1, 3), 16), l = parseInt(t.color.hex.slice(3, 5), 16), h = parseInt(t.color.hex.slice(5, 7), 16);
  let $ = t.color.alpha;
  if (t.scaleX !== void 0 && t.scaleX < 1) {
    const u = 1 - (t.scaleX ?? 1);
    $ = $ * u * 1.5, a = a * 0.4;
  }
  const p = s($);
  return o.push(
    `<filter id="${n}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${r}" dy="${i}" stdDeviation="${s(a)}" flood-color="rgb(${c},${l},${h})" flood-opacity="${p}"/></filter>`
  ), n;
}
function oe2(t, o, e, n, r, i) {
  const a = Oe2(t, n.width, n.height);
  let c;
  if (i) {
    const f = `${t.id}:p`;
    for (const p of i)
      if (p.startsWith(f)) {
        const u = Number(p.slice(f.length));
        isNaN(u) || (c || (c = /* @__PURE__ */ new Set()), c.add(u));
      }
  }
  let l;
  switch (t.type) {
    case "shape":
      l = Ce2(t, o, e, r, c);
      break;
    case "image":
      l = ke2(t, o, e);
      break;
    case "media":
      l = Pe2(t);
      break;
    case "table":
      l = Ae2(t, r);
      break;
    case "chart":
      l = Be2(t);
      break;
    case "group":
      l = _e2(t, o, e, n, r, i);
      break;
    default:
      l = "";
  }
  if (!l) return "";
  let h = "";
  t.shadow && (h = ` filter="url(#${Re2(t.shadow, o, e)})"`);
  const $ = i != null && i.includes(t.id) ? ' visibility="hidden"' : "";
  return `<g data-pagus-id="${t.id}" transform="${a}"${h}${$}>${l}</g>`;
}
function _e2(t, o, e, n, r, i) {
  return t.children.map((a) => oe2(a, o, e, n, r, i)).join("");
}
function Ke2(t, o, e) {
  const n = (e == null ? void 0 : e.scale) ?? 1, r = re2("pagus"), i = [], a = d(o.width), c = d(o.height), l = a * n, h = c * n;
  let $;
  e != null && e.backgroundColor ? $ = `<rect width="${s(a)}" height="${s(c)}" fill="${e.backgroundColor}"/>` : $ = se2(t.background, o, i, r);
  const f = e == null ? void 0 : e.fontSubstitutes, p = e == null ? void 0 : e.hiddenShapeIds, u = t.elements.map((b) => oe2(b, i, r, o, f, p)).join(""), x = (e != null && e.fontCss ? `<style>${e.fontCss}</style>` : "") + i.join(""), g = x ? `<defs>${x}</defs>` : "";
  return {
    svg: [
      '<svg xmlns="http://www.w3.org/2000/svg"',
      ' xmlns:xlink="http://www.w3.org/1999/xlink"',
      ` viewBox="0 0 ${s(a)} ${s(c)}"`,
      ` width="${s(l)}" height="${s(h)}"`,
      ' style="font-family:sans-serif">',
      g,
      $,
      u,
      "</svg>"
    ].join(""),
    width: l,
    height: h
  };
}
export {
  XMLParser,
  Jx as parse,
  Ke2 as renderSlide
};
/*! Bundled license information:

jszip/dist/jszip.min.js:
  (*!
  
  JSZip v3.10.2 - A JavaScript class for generating and reading zip files
  <http://stuartk.com/jszip>
  
  (c) 2009-2016 Stuart Knightley <stuart [at] stuartk.com>
  Dual licenced under the MIT license or GPLv3. See https://raw.github.com/Stuk/jszip/main/LICENSE.markdown.
  
  JSZip uses the library pako released under the MIT license :
  https://github.com/nodeca/pako/blob/main/LICENSE
  *)
*/
