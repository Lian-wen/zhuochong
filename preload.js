'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  patchConfig: (p) => ipcRenderer.invoke('config:patch', p),
  setSecret: (name, value) => ipcRenderer.invoke('secret:set', { name, value }),
  getData: () => ipcRenderer.invoke('data:get'),
  refresh: (card) => ipcRenderer.invoke('data:refresh', card),
  searchCity: (q) => ipcRenderer.invoke('city:search', q),
  openPanel: (x) => ipcRenderer.invoke('panel:show', x),
  closePanel: () => ipcRenderer.invoke('panel:hide'),
  setIgnore: (v) => ipcRenderer.invoke('stage:ignore', v),
  say: (t) => ipcRenderer.invoke('pet:say', t),
  quit: () => ipcRenderer.invoke('app:quit'),
  openConfigDir: () => ipcRenderer.invoke('app:openConfigDir'),
  openPetDir: () => ipcRenderer.invoke('app:openPetDir'),
  pickImage: () => ipcRenderer.invoke('pet:pickImage'),
  clearImage: () => ipcRenderer.invoke('pet:clearImage'),
  petList: () => ipcRenderer.invoke('pet:list'),
  petSelect: (p) => ipcRenderer.invoke('pet:select', p),
  openLink: (u) => ipcRenderer.invoke('sheet:open', u),
  shotScreen: () => ipcRenderer.invoke('shot:screen'),
  shotRegion: () => ipcRenderer.invoke('shot:region'),
  libAdd: (item) => ipcRenderer.invoke('lib:add', item),
  libRemove: (id) => ipcRenderer.invoke('lib:remove', id),
  libCopy: (id) => ipcRenderer.invoke('lib:copy', id),
  libExport: () => ipcRenderer.invoke('lib:export'),
  shotConfirm: (rect) => ipcRenderer.invoke('shot:confirm', rect),
  shotCancel: () => ipcRenderer.invoke('shot:cancel'),
  shotReady: () => ipcRenderer.invoke('shot:ready'),
  on: (channel, cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});
