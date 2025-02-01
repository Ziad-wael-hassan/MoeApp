export const MEDIA_PATTERNS = {
  instagram:
    /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reels?|stories)\/([A-Za-z0-9-_]+)(?:\?.*)?/i,
  tiktok:
    /https?:\/\/(?:(?:www|vm|vt|m)\.)?tiktok\.com\/(?:@[\w.-]+\/video\/\d+|[\w.-]+\/?\??.*|v\/[\w.-]+|t\/[\w.-]+)?/i,
  facebook:
    /https?:\/\/(?:www\.)?facebook\.com\/(?:(?:watch\/\?v=\d+)|(?:[\w.-]+\/videos\/\d+)|(?:reel\/\d+)|(?:share\/r\/[\w-]+\/)|(?:[\w.-]+\/(?:posts|photos)\/[\w.-]+))(?:\?(?:[\w%&=.-]+))?/i,
  soundcloud:
    /https?:\/\/(?:(?:www\.|m\.)?soundcloud\.com\/[\w-]+\/[\w-]+(?:\?.*)?|on\.soundcloud\.com\/[\w-]+)/i,
};
