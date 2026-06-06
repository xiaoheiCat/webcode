const path = require("path");

const outDir = path.resolve(__dirname, "../static");

module.exports = [
  {
    name: "stack",
    entry: "./stack.js",
    output: {
      path: outDir,
      filename: "stack.js",
      library: {
        name: "Stack",
        type: "assign-properties",
      },
    },
  },
  {
    name: "stack-worker",
    entry: "./stack-worker.js",
    output: {
      path: outDir,
      filename: "stack-worker.js",
    },
  },
];
