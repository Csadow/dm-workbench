const { contextBridge, ipcRenderer } = require('electron');
const call = (name,...args) => ipcRenderer.invoke('dmw:invoke',name,args);
contextBridge.exposeInMainWorld('dmw',Object.freeze({
  storage:Object.freeze({
    listCampaigns:()=>call('listCampaigns'),
    saveCampaign:(campaign,options)=>call('saveCampaign',campaign,options),
    getAsset:(id,campaign)=>call('getAsset',id,campaign),
    loadCampaignBundle:id=>call('loadCampaignBundle',id),
    loadProfile:()=>call('loadProfile'),
    saveProfile:profile=>call('saveProfile',profile),
  }),
  linkImport:(source,target)=>call('linkImport',source,target),
  info:()=>call('info'),openFolder:()=>call('openFolder'),chooseLibrary:()=>call('chooseLibrary'),
  backup:()=>call('backup'),restore:()=>call('restore'),importLegacyMemory:()=>call('importLegacyMemory'),
  startAI:()=>call('startAI'),setupAI:()=>call('setupAI'),chooseAI:()=>call('chooseAI'),
}));
