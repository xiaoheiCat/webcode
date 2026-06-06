(function (global) {
  "use strict";

  var CTRL_IDLE = 0;
  var CTRL_DONE = 1;
  var CTRL_REQ = 2;

  var FILETYPE_DIRECTORY = 3;
  var FILETYPE_REGULAR_FILE = 4;

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

  function mapErrno(errno) {
    if (errno === 2) return 44;
    return errno;
  }

  function joinPath(base, name) {
    if (!base || base === ".") return name;
    return base + "/" + name;
  }

  function decodeBase64(data) {
    var raw = atob(data || "");
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function createHostBridgeFS(FS, bridge) {
    var FILE_MODE = 33206;
    var DIR_MODE = 16895;

    var HostBridgeFS = {
      mount: function () {
        var root = HostBridgeFS.createNode(null, "/", DIR_MODE, 0);
        root.hostPath = ".";
        return root;
      },

      createNode: function (parent, name, mode, dev) {
        if (!FS.isDir(mode) && !FS.isFile(mode)) {
          throw new FS.ErrnoError(28);
        }
        var node = FS.createNode(parent, name, mode, dev);
        node.node_ops = HostBridgeFS;
        node.stream_ops = HostBridgeFS;
        node.hostPath = null;
        return node;
      },

      getattr: function (node) {
        var resp = bridge.call({ op: "stat", path: node.hostPath || "." });
        if (resp.errno) throw new FS.ErrnoError(mapErrno(resp.errno));
        return {
          dev: 1,
          ino: node.id,
          mode: node.mode,
          nlink: 1,
          uid: 0,
          gid: 0,
          rdev: undefined,
          size: resp.filetype === FILETYPE_REGULAR_FILE ? (resp.size || 0) : 4096,
          atime: new Date(),
          mtime: new Date(),
          ctime: new Date(),
          blksize: 4096,
          blocks: 1,
        };
      },

      lookup: function (parent, name) {
        var path = joinPath(parent.hostPath, name);
        var resp = bridge.call({ op: "stat", path: path });
        if (resp.errno) throw new FS.ErrnoError(mapErrno(resp.errno));
        var mode = resp.filetype === FILETYPE_DIRECTORY ? DIR_MODE : FILE_MODE;
        var node = HostBridgeFS.createNode(parent, name, mode, 0);
        node.hostPath = path;
        return node;
      },

      readdir: function (node) {
        var resp = bridge.call({ op: "readdir", path: node.hostPath || ".", cookie: 0 });
        if (resp.errno) throw new FS.ErrnoError(mapErrno(resp.errno));
        var entries = [".", ".."];
        (resp.entries || []).forEach(function (entry) {
          entries.push(entry.name);
        });
        return entries;
      },

      mknod: function (parent, name, mode) {
        var path = joinPath(parent.hostPath, name);
        var resp = bridge.call({ op: "open", path: path, oflags: 1 });
        if (resp.errno) throw new FS.ErrnoError(mapErrno(resp.errno));
        bridge.call({ op: "close", fd: resp.fd });
        var node = HostBridgeFS.createNode(parent, name, mode, 0);
        node.hostPath = path;
        return node;
      },

      mkdir: function (parent, name) {
        var path = joinPath(parent.hostPath, name);
        var resp = bridge.call({ op: "mkdir", path: path });
        if (resp.errno) throw new FS.ErrnoError(mapErrno(resp.errno));
        var node = HostBridgeFS.createNode(parent, name, DIR_MODE, 0);
        node.hostPath = path;
        return node;
      },

      unlink: function (parent, name) {
        var path = joinPath(parent.hostPath, name);
        var resp = bridge.call({ op: "unlink", path: path });
        if (resp.errno) throw new FS.ErrnoError(mapErrno(resp.errno));
      },

      rmdir: function (parent, name) {
        var path = joinPath(parent.hostPath, name);
        var resp = bridge.call({ op: "rmdir", path: path });
        if (resp.errno) throw new FS.ErrnoError(mapErrno(resp.errno));
      },

      open: function (stream) {
        var oflags = 0;
        if (stream.flags & 512) oflags |= 1;
        if (stream.flags & 2097152) oflags |= 2;
        var resp = bridge.call({
          op: "open",
          path: stream.node.hostPath,
          oflags: oflags,
        });
        if (resp.errno) throw new FS.ErrnoError(mapErrno(resp.errno));
        stream.hostFd = resp.fd;
      },

      close: function (stream) {
        if (stream.hostFd != null) {
          bridge.call({ op: "close", fd: stream.hostFd });
          stream.hostFd = null;
        }
      },

      read: function (stream, buffer, offset, length, position) {
        var resp = bridge.call({
          op: "read",
          fd: stream.hostFd,
          len: length,
          offset: position,
        });
        if (resp.errno) throw new FS.ErrnoError(mapErrno(resp.errno));
        var bytes = decodeBase64(resp.data);
        var n = Math.min(bytes.length, length);
        buffer.set(bytes.subarray(0, n), offset);
        return n;
      },

      write: function (stream, buffer, offset, length, position) {
        var slice = buffer.subarray(offset, offset + length);
        var b64 = btoa(String.fromCharCode.apply(null, slice));
        var resp = bridge.call({
          op: "write",
          fd: stream.hostFd,
          data: b64,
          offset: position,
        });
        if (resp.errno) throw new FS.ErrnoError(mapErrno(resp.errno));
        return resp.nwritten || 0;
      },

      llseek: function (stream, offset, whence) {
        var resp = bridge.call({
          op: "seek",
          fd: stream.hostFd,
          offset: offset,
          whence: whence,
        });
        if (resp.errno) throw new FS.ErrnoError(mapErrno(resp.errno));
        return resp.offset || 0;
      },
    };

    return HostBridgeFS;
  }

  function ensureMemoryWorkspace(mod) {
    try {
      mod.FS.mkdir("/workspace");
    } catch (e) {}
  }

  function mountHostWorkspace(mod, shared) {
    var FS = mod.FS;
    var bridge = new FsBridge(shared);
    var hostFS = createHostBridgeFS(FS, bridge);
    try {
      FS.mkdir("/workspace");
    } catch (e) {}
    FS.mount(hostFS, {}, "/workspace");
  }

  function setupWorkspace(mod, workspace) {
    if (workspace && workspace.mode === "host" && workspace.fsShared) {
      mountHostWorkspace(mod, workspace.fsShared);
      return;
    }
    ensureMemoryWorkspace(mod);
  }

  global.WebCodeEmscriptenHostFs = {
    setupWorkspace: setupWorkspace,
  };
})(window);
