export const MEDIA_PATTERNS = {
  INSTAGRAM:
    /\bhttps?:\/\/(?:www\.)?instagram\.com\/(?:p|reels?|stories)\/([A-Za-z0-9-_]+)(?:\?.*)?/i,

  TIKTOK:
    /\bhttps?:\/\/(?:(?:www|vm|vt|m)\.)?tiktok\.com\/(?:@[\w.-]+\/video\/\d+|[\w.-]+\/?\??.*|v\/[\w.-]+|t\/[\w.-]+)?/i,

  FACEBOOK:
    /\bhttps?:\/\/(?:www\.)?facebook\.com\/(?:(?:watch\/\?v=\d+)|(?:[\w.-]+\/videos\/\d+)|(?:reel\/\d+)|(?:share\/r\/[\w-]+\/)|(?:[\w.-]+\/(?:posts|photos)\/[\w.-]+))(?:\?(?:[\w%&=.-]+))?/i,

  YOUTUBE:
    /\bhttps?:\/\/(?:(?:www\.)?youtube\.com\/(?:shorts\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]+)(?:\?.*)?/i,
};
