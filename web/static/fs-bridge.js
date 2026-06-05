"use strict";

var CTRL_IDLE = 0;
var CTRL_DONE = 1;
var CTRL_REQ = 2;

function FsBridge(shared) {
  this.streamCtrl = new Int32Array(shared, 0, 1);
  this.streamStatus = new Int32Array(shared, 4, 1);
  this.streamLen = new Int32Array(shared, 8, 1);
  this.streamData = new Uint8Array(shared, 12);
}

FsBridge.prototype.call = function (req) {
  var enc = new TextEncoder().encode(JSON.stringify(req));
  if (enc.length > this.streamData.length) {
    return { errno: 29 };
  }
  this.streamData.set(enc, 0);
  this.streamLen[0] = enc.length;
  this.streamStatus[0] = 0;
  Atomics.store(this.streamCtrl, 0, CTRL_REQ);
  Atomics.notify(this.streamCtrl, 0);
  while (Atomics.load(this.streamCtrl, 0) === CTRL_REQ) {
    Atomics.wait(this.streamCtrl, 0, CTRL_REQ);
  }
  var json = new TextDecoder().decode(this.streamData.slice(0, this.streamLen[0]));
  Atomics.store(this.streamCtrl, 0, CTRL_IDLE);
  return JSON.parse(json);
};

function HostFile(fd, bridge, filetype) {
  this.fd = fd;
  this.bridge = bridge;
  this.filetype = filetype;
  this.file_pos = 0n;
}

HostFile.prototype.fd_fdstat_get = function () {
  return { ret: 0, fdstat: new Fdstat(this.filetype, 0) };
};

HostFile.prototype.fd_read = function (size) {
  var resp = this.bridge.call({
    op: "read", fd: this.fd, len: size, offset: Number(this.file_pos),
  });
  if (resp.errno) return { ret: resp.errno, data: new Uint8Array() };
  var raw = atob(resp.data || "");
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  this.file_pos += BigInt(out.length);
  return { ret: 0, data: out };
};

HostFile.prototype.fd_pread = function (size, offset) {
  var resp = this.bridge.call({
    op: "read", fd: this.fd, len: size, offset: Number(offset),
  });
  if (resp.errno) return { ret: resp.errno, data: new Uint8Array() };
  var raw = atob(resp.data || "");
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return { ret: 0, data: out };
};

HostFile.prototype.fd_write = function (data) {
  var b64 = btoa(String.fromCharCode.apply(null, data));
  var resp = this.bridge.call({
    op: "write", fd: this.fd, data: b64, offset: Number(this.file_pos),
  });
  if (resp.errno) return { ret: resp.errno, nwritten: 0 };
  this.file_pos += BigInt(resp.nwritten || 0);
  return { ret: 0, nwritten: resp.nwritten || 0 };
};

HostFile.prototype.fd_pwrite = function (data, offset) {
  var b64 = btoa(String.fromCharCode.apply(null, data));
  var resp = this.bridge.call({
    op: "write", fd: this.fd, data: b64, offset: Number(offset),
  });
  if (resp.errno) return { ret: resp.errno, nwritten: 0 };
  return { ret: 0, nwritten: resp.nwritten || 0 };
};

HostFile.prototype.fd_seek = function (offset, whence) {
  var resp = this.bridge.call({
    op: "seek", fd: this.fd, offset: Number(offset), whence: whence,
  });
  if (resp.errno) return { ret: resp.errno, offset: 0n };
  this.file_pos = BigInt(resp.offset || 0);
  return { ret: 0, offset: this.file_pos };
};

HostFile.prototype.fd_tell = function () {
  return { ret: 0, offset: this.file_pos };
};

HostFile.prototype.fd_close = function () {
  this.bridge.call({ op: "close", fd: this.fd });
  return 0;
};

HostFile.prototype.fd_filestat_get = function () {
  return {
    ret: 0,
    filestat: new Filestat(1n, this.filetype, this.file_pos),
  };
};

function HostPreopenDirectory(name, bridge) {
  this.prestat_name = name;
  this.bridge = bridge;
  this.ino = 0n;
}

HostPreopenDirectory.prototype.fd_prestat_get = function () {
  return { ret: 0, prestat: Prestat.dir(this.prestat_name) };
};

HostPreopenDirectory.prototype.fd_fdstat_get = function () {
  return { ret: 0, fdstat: new Fdstat(FILETYPE_DIRECTORY, 0) };
};

HostPreopenDirectory.prototype.fd_readdir_single = function (cookie) {
  var resp = this.bridge.call({ op: "readdir", path: ".", cookie: cookie });
  if (resp.errno) return { ret: resp.errno, dirent: null };
  var idx = Number(cookie);
  if (idx === 0) {
    return {
      ret: 0,
      dirent: new Dirent(1n, 0n, ".", FILETYPE_DIRECTORY),
    };
  }
  if (idx === 1) {
    return {
      ret: 0,
      dirent: new Dirent(2n, 0n, "..", FILETYPE_DIRECTORY),
    };
  }
  var entries = resp.entries || [];
  var entryIdx = idx - 2;
  if (entryIdx >= entries.length) {
    return { ret: 0, dirent: null };
  }
  var entry = entries[entryIdx];
  return {
    ret: 0,
    dirent: new Dirent(BigInt(idx + 1), BigInt(entryIdx + 3), entry.name, entry.filetype),
  };
};

HostPreopenDirectory.prototype.path_open = function (dirflags, path, oflags, fs_rights_base, fs_rights_inheriting, fd_flags) {
  var resp = this.bridge.call({ op: "open", path: path, oflags: oflags });
  if (resp.errno) return { ret: resp.errno, fd_obj: null };
  return {
    ret: 0,
    fd_obj: new HostFile(resp.fd, this.bridge, resp.filetype),
  };
};

HostPreopenDirectory.prototype.path_filestat_get = function (flags, path) {
  var resp = this.bridge.call({ op: "stat", path: path });
  if (resp.errno) return { ret: resp.errno, filestat: null };
  return {
    ret: 0,
    filestat: new Filestat(BigInt(1), resp.filetype, BigInt(resp.size || 0)),
  };
};

HostPreopenDirectory.prototype.path_create_directory = function (path) {
  var resp = this.bridge.call({ op: "mkdir", path: path });
  return resp.errno || 0;
};

HostPreopenDirectory.prototype.path_unlink_file = function (path) {
  var resp = this.bridge.call({ op: "unlink", path: path });
  return resp.errno || 0;
};

HostPreopenDirectory.prototype.path_remove_directory = function (path) {
  var resp = this.bridge.call({ op: "rmdir", path: path });
  return resp.errno || 0;
};

HostPreopenDirectory.prototype.path_lookup = function (path, dirflags) {
  var resp = this.bridge.call({ op: "stat", path: path });
  if (resp.errno) return { ret: resp.errno, inode_obj: null };
  return { ret: 0, inode_obj: { stat: function () {
    return new Filestat(1n, resp.filetype, BigInt(resp.size || 0));
  } } };
};

HostPreopenDirectory.prototype.fd_seek = function () {
  return { ret: 28, offset: 0n };
};

HostPreopenDirectory.prototype.fd_read = function () {
  return { ret: 28, data: new Uint8Array() };
};

HostPreopenDirectory.prototype.fd_write = function () {
  return { ret: 28, nwritten: 0 };
};

function buildWorkspaceDir(config) {
  if (!config || config.mode === "memory") {
    return new PreopenDirectory("/workspace", []);
  }
  if (config.mode === "host" && config.shared) {
    return new HostPreopenDirectory("/workspace", new FsBridge(config.shared));
  }
  return new PreopenDirectory("/workspace", []);
}
