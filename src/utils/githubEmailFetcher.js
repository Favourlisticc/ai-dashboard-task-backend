const axios = require('axios');

class GitHubEmailFetcher {
  static async getUserEmails(accessToken) {
    try {
      const response = await axios.get('https://api.github.com/user/emails', {
        headers: {
          'Authorization': `token ${accessToken}`,
          'User-Agent': 'NexusAI-App',
          'Accept': 'application/vnd.github.v3+json'
        },
        timeout: 10000
      });

      if (response.status === 200) {
        return response.data;
      }
      return null;
    } catch (error) {
      console.error('GitHub email fetch error:', error.response?.data || error.message);
      return null;
    }
  }

  static getBestEmail(emails, githubProfile) {
    if (!emails || emails.length === 0) {
      return `${githubProfile.username}@users.noreply.github.com`;
    }

    // Priority: primary + verified -> verified -> primary -> first email
    const primaryVerified = emails.find(e => e.primary && e.verified);
    if (primaryVerified) return primaryVerified.email;

    const verified = emails.find(e => e.verified);
    if (verified) return verified.email;

    const primary = emails.find(e => e.primary);
    if (primary) return primary.email;

    return emails[0].email;
  }
}

module.exports = GitHubEmailFetcher;