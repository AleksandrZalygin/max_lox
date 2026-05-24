import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  call: (method: string, path: string, body?: unknown) =>
    ipcRenderer.invoke("api-call", { method, path, body }),
});
