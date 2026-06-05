/* eslint-disable no-constant-condition */
"use strict";

var CTRL_IDLE = 0;
var CTRL_DONE = 1;
var CTRL_REQ = 2;

var ERRNO_SUCCESS = 0;
var ERRNO_NOENT = 2;
var ERRNO_EXIST = 20;
var ERRNO_NOTDIR = 54;
var ERRNO_ISDIR = 31;
var ERRNO_NOTEMPTY = 55;
var ERRNO_INVAL = 28;
var ERRNO_IO = 29;
var FILETYPE_REGULAR_FILE = 4;
var FILETYPE_DIRECTORY = 3;
var OFLAGS_CREAT = 1;
var OFLAGS_DIRECTORY = 2;

var streamCtrl;
var streamStatus;
var streamLen;
var streamData;
var rootHandle;
var openFiles = {};
var nextFd = 1;

function bindShared(shared) {
  streamCtrl = new Int32Array(shared, 0, 1);
  streamStatus = new Int32Array(shared, 4, 1);
  streamLen = new Int32Array(shared, 8, 1);
  streamData = new Uint8Array(shared, 12);
}

function writeResp(obj) {
  var json = JSON.stringify(obj);
  var enc = new TextEncoder().encode(json);
  if (enc.length > streamData.length) {
    streamStatus[0] = -ERRNO_IO;
    streamLen[0] = 0;
    return;
  }
  streamData.set(enc, 0);
  streamLen[0] = enc.length;
  streamStatus[0] = obj.errno || 0;
}

function readReq() {
  var json = new TextDecoder().decode(streamData.slice(0, streamLen[0]));
  return JSON.parse(json);
}

function splitPath(path) {
  if (!path || path === "." || path === "./") return [];
  return path.split("/").filter(function (p) { return p && p !== "."; });
}

async function resolveParent(path, create) {
  var parts = splitPath(path);
  if (parts.length === 0) {
    return { dir: rootHandle, name: null, parent: null };
  }
  var name = parts.pop();
  var dir = rootHandle;
  for (var i = 0; i < parts.length; i++) {
    try {
      dir = await dir.getDirectoryHandle(parts[i], { create: !!create });
    } catch (e) {
      return { errno: ERRNO_NOENT };
    }
  }
  return { dir: dir, name: name, parent: dir };
}

async function handleStat(req) {
  var resolved = await resolveParent(req.path, false);
  if (resolved.errno) return { errno: resolved.errno };
  if (!resolved.name) {
    return { errno: 0, filetype: FILETYPE_DIRECTORY, size: 0 };
  }
  try {
    var fh = await resolved.dir.getFileHandle(resolved.name);
    var file = await fh.getFile();
    return { errno: 0, filetype: FILETYPE_REGULAR_FILE, size: file.size };
  } catch (e) {
    try {
      await resolved.dir.getDirectoryHandle(resolved.name);
      return { errno: 0, filetype: FILETYPE_DIRECTORY, size: 0 };
    } catch (e2) {
      return { errno: ERRNO_NOENT };
    }
  }
}

async function handleReaddir(req) {
  var resolved = await resolveParent(req.path || ".", false);
  if (resolved.errno) return { errno: resolved.errno };
  var dir = resolved.name ? await resolved.dir.getDirectoryHandle(resolved.name) : resolved.dir;
  var entries = [];
  for await (var entry of dir.values()) {
    entries.push({
      name: entry.name,
      filetype: entry.kind === "directory" ? FILETYPE_DIRECTORY : FILETYPE_REGULAR_FILE,
    });
  }
  entries.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { errno: 0, entries: entries, cookie: req.cookie || 0 };
}

async function handleOpen(req) {
  var resolved = await resolveParent(req.path, !!(req.oflags & 1));
  if (resolved.errno) return { errno: resolved.errno };
  var create = !!(req.oflags & OFLAGS_CREAT);
  var isDir = !!(req.oflags & OFLAGS_DIRECTORY);
  try {
    if (isDir) {
      var dh = await resolved.dir.getDirectoryHandle(resolved.name, { create: create });
      var fd = nextFd++;
      openFiles[fd] = { kind: "dir", handle: dh, path: req.path, pos: 0 };
      return { errno: 0, fd: fd, filetype: FILETYPE_DIRECTORY };
    }
    var fh;
    if (create) {
      fh = await resolved.dir.getFileHandle(resolved.name, { create: true });
    } else {
      fh = await resolved.dir.getFileHandle(resolved.name);
    }
    var fd2 = nextFd++;
    openFiles[fd2] = { kind: "file", handle: fh, path: req.path, pos: 0 };
    return { errno: 0, fd: fd2, filetype: FILETYPE_REGULAR_FILE };
  } catch (e) {
    return { errno: ERRNO_NOENT };
  }
}

async function handleRead(req) {
  var f = openFiles[req.fd];
  if (!f || f.kind !== "file") return { errno: ERRNO_INVAL };
  var file = await f.handle.getFile();
  var buf = await file.arrayBuffer();
  var view = new Uint8Array(buf);
  var start = req.offset != null ? req.offset : f.pos;
  var end = Math.min(start + req.len, view.length);
  var slice = view.slice(start, end);
  f.pos = end;
  var b64 = btoa(String.fromCharCode.apply(null, slice));
  return { errno: 0, data: b64, nread: slice.length };
}

async function handleWrite(req) {
  var f = openFiles[req.fd];
  if (!f || f.kind !== "file") return { errno: ERRNO_INVAL };
  var raw = atob(req.data || "");
  var bytes = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  var file = await f.handle.getFile();
  var existing = new Uint8Array(await file.arrayBuffer());
  var offset = req.offset != null ? req.offset : f.pos;
  if (offset + bytes.length > existing.length) {
    var out = new Uint8Array(offset + bytes.length);
    out.set(existing.subarray(0, existing.length));
    out.set(bytes, offset);
    existing = out;
  } else {
    var copy = new Uint8Array(existing);
    copy.set(bytes, offset);
    existing = copy;
  }
  var writable = await f.handle.createWritable();
  await writable.write(existing);
  await writable.close();
  f.pos = offset + bytes.length;
  return { errno: 0, nwritten: bytes.length };
}

async function handleSeek(req) {
  var f = openFiles[req.fd];
  if (!f || f.kind !== "file") return { errno: ERRNO_INVAL };
  var file = await f.handle.getFile();
  var size = file.size;
  var pos = f.pos;
  if (req.whence === 0) pos = req.offset;
  else if (req.whence === 1) pos = f.pos + req.offset;
  else if (req.whence === 2) pos = size + req.offset;
  if (pos < 0) return { errno: ERRNO_INVAL };
  f.pos = pos;
  return { errno: 0, offset: pos };
}

async function handleClose(req) {
  delete openFiles[req.fd];
  return { errno: 0 };
}

async function handleMkdir(req) {
  var resolved = await resolveParent(req.path, true);
  if (resolved.errno) return { errno: resolved.errno };
  try {
    await resolved.dir.getDirectoryHandle(resolved.name, { create: true });
    return { errno: 0 };
  } catch (e) {
    return { errno: ERRNO_EXIST };
  }
}

async function handleUnlink(req) {
  var resolved = await resolveParent(req.path, false);
  if (resolved.errno) return { errno: resolved.errno };
  try {
    await resolved.dir.removeEntry(resolved.name);
    return { errno: 0 };
  } catch (e) {
    return { errno: ERRNO_NOENT };
  }
}

async function handleRmdir(req) {
  var resolved = await resolveParent(req.path, false);
  if (resolved.errno) return { errno: resolved.errno };
  try {
    var dh = await resolved.dir.getDirectoryHandle(resolved.name);
    var count = 0;
    for await (var _entry of dh.values()) { count++; }
    if (count > 0) return { errno: ERRNO_NOTEMPTY };
    await resolved.dir.removeEntry(resolved.name);
    return { errno: 0 };
  } catch (e) {
    return { errno: ERRNO_NOENT };
  }
}

async function dispatch(req) {
  switch (req.op) {
    case "stat": return handleStat(req);
    case "readdir": return handleReaddir(req);
    case "open": return handleOpen(req);
    case "read": return handleRead(req);
    case "write": return handleWrite(req);
    case "seek": return handleSeek(req);
    case "close": return handleClose(req);
    case "mkdir": return handleMkdir(req);
    case "unlink": return handleUnlink(req);
    case "rmdir": return handleRmdir(req);
    default: return { errno: ERRNO_INVAL };
  }
}

async function processRequest() {
  var req = readReq();
  try {
    var resp = await dispatch(req);
    writeResp(resp);
  } catch (e) {
    writeResp({ errno: ERRNO_IO, message: String(e) });
  }
  Atomics.store(streamCtrl, 0, CTRL_DONE);
  Atomics.notify(streamCtrl, 0);
}

function serveLoop() {
  while (true) {
    Atomics.wait(streamCtrl, 0, CTRL_IDLE);
    if (Atomics.load(streamCtrl, 0) === CTRL_REQ) {
      processRequest();
    }
  }
}

onmessage = function (e) {
  if (e.data && e.data.type === "init") {
    bindShared(e.data.shared);
    rootHandle = e.data.handle;
    Atomics.store(streamCtrl, 0, CTRL_IDLE);
    postMessage({ type: "ready" });
    serveLoop();
  }
};
