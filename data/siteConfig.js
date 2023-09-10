module.exports = {
  siteTitle: '작은 성장을 누적하기',
  siteDescription: '',
  authorName: 'Jean Suh',
  twitterUsername: '',
  authorAvatar: 'profile.png', // file in content/images
  defaultLang: 'ko', // show flag if lang is not default. Leave empty to enable flags in post lists
  authorDescription: `
  금융과 소비자의 교두보가 되고 싶은 개발자.
  `,
  siteUrl: 'https://jeansuh42.github.io/',
  disqusSiteUrl: 'https://jeansuh42.github.io/',
  // Prefixes all links. For cases when deployed to maxpou.fr/gatsby-starter-morning-dew/
  pathPrefix: '/gatsby-starter-morning-dew', // Note: it must *not* have a trailing slash.
  siteCover: 'sea.jpeg', // file in content/images
  background_color: '#ffffff',
  theme_color: '#222222',
  display: 'standalone',
  icon: 'content/images/profile.png',
  postsPerPage: 10,
  disqusShortname: 'jeansuh42',
  headerTitle: '작은 성장을 누적하기',
  headerLinksIcon: 'logo.png', //  (leave empty to disable: '')
  headerLinks: [
    {
      label: 'Blog',
      url: '/',
    },
    {
      label: 'About Me',
      url: 'https://jeansuh42.github.io/',
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
          url: 'https://github.com/jeansuh42',
          rel: 'external',
        },        
        {
          label: 'Rocketpunch',
          url: 'https://www.rocketpunch.com/@jeansuh97',
          rel: 'external',
        },
      ],
    },
  ],
}
