import React, { Fragment } from 'react'

import PostsListItem from './PostsListItem'
import useSiteMetadata from '../hooks/use-site-config'

const PostsList = ({ posts }) => {
  const { defaultLang } = useSiteMetadata()

  const truncate = (text, maxLength) => {
    if (text.length > maxLength) {
      return `${text.substring(0, maxLength)}...`;
    }
    return text;
  };


  return (
    <Fragment>
      {posts.map(post => {
        const props = {
          title: post.node.frontmatter.title,
          excerpt: truncate(post.node.excerpt, 50),
          date: post.node.frontmatter.date,
          slug: post.node.frontmatter.slug,
          timeToRead: post.node.timeToRead,
          language: post.node.frontmatter.language || defaultLang,
          tags: post.node.frontmatter.tags || [],
        }
        return <PostsListItem key={props.slug} {...props} />
      })}
    </Fragment>
  )
}
export default PostsList
