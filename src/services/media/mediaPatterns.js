export const MEDIA_PATTERNS = {
  instagram:
    /\bhttps?:\/\/(?:www\.)?instagram\.com\/(?:p|reels?|stories)\/([A-Za-z0-9-_]+)(?:\?.*)?/i,

  tiktok:
    /\bhttps?:\/\/(?:(?:www|vm|vt|m)\.)?tiktok\.com\/(?:@[\w.-]+\/video\/\d+|[\w.-]+\/?\??.*|v\/[\w.-]+|t\/[\w.-]+)?/i,

  facebook:
    /\bhttps?:\/\/(?:www\.)?facebook\.com\/(?:(?:watch\/\?v=\d+)|(?:[\w.-]+\/videos\/\d+)|(?:reel\/\d+)|(?:share\/r\/[\w-]+\/)|(?:[\w.-]+\/(?:posts|photos)\/[\w.-]+))(?:\?(?:[\w%&=.-]+))?/i,
};
