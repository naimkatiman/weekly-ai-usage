'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (name, ...args) => ipcRenderer.invoke('desktop:' + name, ...args);
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  getState: () => call('getState'),
  addProfile: input => call('addProfile', input),
  updateProfile: (id, patch) => call('updateProfile', id, patch),
  removeProfile: id => call('removeProfile', id),
  chooseFolder: kind => call('chooseFolder', kind),
  chooseExecutable: () => call('chooseExecutable'),
  refreshUsage: () => call('refreshUsage'),
  launchProfile: (id, action) => call('launchProfile', id, action),
  setPrivacy: enabled => call('setPrivacy', enabled),
  setDefault: id => call('setDefault', id),
  importLegacy: () => call('importLegacy'),
  openProviderDocs: provider => call('openProviderDocs', provider),
}));
