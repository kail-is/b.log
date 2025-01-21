module.exports = {
  siteTitle: '작은 성장을 누적하기',
  siteDescription: '',
  authorName: '서은빈',
  twitterUsername: '',
  authorAvatar: 'profile.png', // file in content/images
  defaultLang: 'ko', // show flag if lang is not default. Leave empty to enable flags in post lists
  authorDescription: `
  1의 개발로 N배의 가치, N개의 문제를 풀고 싶은 개발자
  `,
  siteUrl: 'https://github.com/kail-is',
  disqusSiteUrl: 'https://github.com/kail-is',
  // Prefixes all links. For cases when deployed to maxpou.fr/gatsby-starter-morning-dew/
  pathPrefix: '/gatsby-starter-morning-dew', // Note: it must *not* have a trailing slash.
  siteCover: 'sea.jpeg', // file in content/images
  background_color: '#ffffff',
  theme_color: '#222222',
  display: 'standalone',
  icon: 'content/images/profile.png',
  postsPerPage: 10,
  disqusShortname: 'beeniyxz',
  headerTitle: '작은 성장을 누적하기',
  headerLinksIcon: 'logo.png', //  (leave empty to disable: '')
  headerLinks: [
    {
      label: 'About Me',
      url: 'https://artesuh.notion.site/13ce1ea9c27980238bc1c53277f3a647',
    },
    {
      label: 'Tags',
      url: '/tags',
    },
  ],
  // Footer information (ex: Github, Netlify...)
  websiteHost: {
    name: 'GitHub',
    url: 'https://github.com',
  },
  footerLinks: [
    {
      sectionName: 'Explore',
      links: [
        {
          label: 'Blog',
          url: '/',
        },
        {
          label: 'About Me',
          url: '/about-me',
        }
      ],
    },
    {
      sectionName: 'You Can Find Me at...',
      links: [
        {
          label: 'GitHub',
          url: 'https://github.com/kail-is',
          rel: 'external',
        },
      ],
    },
  ],
}
