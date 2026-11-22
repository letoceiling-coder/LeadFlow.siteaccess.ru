const Module = require("module");

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  const id = String(request);
  if (id === "server-only" || id.includes("node_modules/server-only/") || id.includes("node_modules\\server-only\\")) {
    return {};
  }
  return originalLoad.apply(this, arguments);
};
