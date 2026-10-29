'use strict';
(() => {
  // Only use the SDK injected by the miniTool container. No web/bridge shim.
  const sdk = () => window.xhs && window.xhs.miniTool;
  function capabilities() {
    const api = sdk();
    return {
      postNote: !!api && typeof api.postNote === 'function',
      save: !!api && typeof api.saveImageToPhotosAlbum === 'function',
    };
  }
  async function imageResource(api, data) {
    if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,')) {
      throw new Error('Invalid artwork');
    }
    if (typeof api.writeTempFile !== 'function') return data;
    const result = await api.writeTempFile({ data });
    if (!result || typeof result.filePath !== 'string' || !result.filePath || /^(?:https?:|blob:)/i.test(result.filePath)) {
      throw new Error('Invalid temporary artwork path');
    }
    return result.filePath;
  }
  window.ArtworkPlatform = Object.freeze({
    capabilities,
    async postNote(data) {
      const api = sdk();
      if (!capabilities().postNote) throw new Error('Open in Xiaohongshu miniTool');
      const url = await imageResource(api, data);
      return api.postNote({
        title: '让山水自己长成一幅画',
        content: '洒下沙、水和种子，等风物慢慢相遇。这是我在「山水自生」里留下的一刻。',
        mediaInfo: { image_resources: [{ url }] },
      });
    },
    async save(data) {
      const api = sdk();
      if (!capabilities().save) throw new Error('Open in Xiaohongshu miniTool');
      const filePath = await imageResource(api, data);
      return api.saveImageToPhotosAlbum({ filePath });
    },
  });
})();
