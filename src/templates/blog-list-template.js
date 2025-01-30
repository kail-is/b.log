import React, { useState, useMemo } from 'react'
import { graphql } from 'gatsby'
import Layout from '../components/layout'
import Wrapper from '../components/Wrapper'
import PostsList from '../components/PostsList'
import Pagination from '../components/Pagination'
import SEO from '../components/SEO'
import config from '../../data/siteConfig'

const HIDDEN_TAGS = config.hiddenTags
const INITIAL_TAGS = config.initialTags
const POSTS_PER_PAGE = 10  // Add this constant to match your limit value

const styles = {
  tagButton: {
    display: 'inline-block',
    padding: '6px 12px',
    margin: '0 8px 8px 0',
    border: '1px solid #e2e8f0',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    transition: 'all 0.2s ease',
    backgroundColor: 'white',
  },
  activeTag: {
    backgroundColor: '#4a5568',
    color: 'white',
    borderColor: '#4a5568',
  },
  inactiveTag: {
    borderColor: '#e2e8f0',
    color: '#4a5568',
    backgroundColor: 'white',
  },
  tagCount: {
    marginLeft: '4px',
    fontSize: '12px',
    opacity: 0.7,
  },
  filterSection: {
    marginBottom: '24px',
  },
  filterHeader: {
    marginBottom: '12px',
    fontSize: '16px',
    fontWeight: 'bold',
    display: 'flex',
    alignItems: 'center'
  },
  selectedTag: {
    display: 'inline-flex',
    alignItems: 'center',
    margin: '0 8px 8px 0',
    padding: '6px 12px',
    backgroundColor: '#4a5568',
    color: 'white',
    borderRadius: '4px',
    fontSize: '14px',
  },
  removeTag: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '15px',
    height: '15px',
    border: 'none',
    cursor: 'pointer',
    color: '#a0aec0',
    fontSize: '12px',
    fontWeight: '300',
    transition: 'all 0.15s ease',
    marginLeft: '8px',
    padding: '0',
    background: 'transparent',
    position: 'relative',
    top: '-1px'
  },
}

const BlogList = ({ data, pageContext, location }) => {
  const { title, description } = data.site.siteMetadata
  const posts = data.posts.edges
  const [selectedTags, setSelectedTags] = useState(INITIAL_TAGS)
  const [currentPage, setCurrentPage] = useState(pageContext.currentPage)

  // Get unique tags from all posts, excluding hidden tags
  const allTags = useMemo(() => {
    const tags = new Set()
    posts.forEach(post => {
      post.node.frontmatter.tags?.forEach(tag => {
        if (!HIDDEN_TAGS.includes(tag)) {
          tags.add(tag)
        }
      })
    })
    return Array.from(tags).sort()
  }, [posts])

  // Filter all posts first
  const filteredPosts = useMemo(() => {
    return posts.filter(post => {
      const postTags = post.node.frontmatter.tags || []

      if (postTags.some(tag => HIDDEN_TAGS.includes(tag))) {
        return false
      }

      if (selectedTags.length === 0) {
        return true
      }

      return selectedTags.some(tag => postTags.includes(tag))
    })
  }, [posts, selectedTags])

  // Calculate pagination after filtering
  const totalPages = Math.ceil(filteredPosts.length / POSTS_PER_PAGE)

  // Get paginated posts from filtered results
  const paginatedPosts = useMemo(() => {
    const startIndex = (currentPage - 1) * POSTS_PER_PAGE
    return filteredPosts.slice(startIndex, startIndex + POSTS_PER_PAGE)
  }, [filteredPosts, currentPage])

  // Reset to first page when filters change
  React.useEffect(() => {
    setCurrentPage(1)
  }, [selectedTags])

  const handleTagClick = (tag) => {
    setSelectedTags(prev => {
      if (prev.includes(tag)) {
        return prev.filter(t => t !== tag)
      }
      return [...prev, tag]
    })
  }

  // 전체 포스트에서 히든태그를 제외한 각 태그의 개수를 계산
  const tagCounts = useMemo(() => {
    const counts = {}
    posts.forEach(post => {
      // 포스트의 모든 태그를 순회하되, hidden이 아닌 태그만 카운트
      post.node.frontmatter.tags?.forEach(tag => {
        if (!HIDDEN_TAGS.includes(tag)) {
          counts[tag] = (counts[tag] || 0) + 1
        }
      })
    })
    return counts
  }, [posts])


  const getTagCount = (tag) => {
    return tagCounts[tag] || 0
  }

  return (
    <Layout location={location}>
      <SEO />
      <Wrapper>
        <div style={styles.filterSection}>
          <div style={styles.filterHeader}>
            <span>Tags</span>
            {selectedTags.length > 0 && (
              <div>
                <button
                  onClick={() => setSelectedTags([])}
                  style={styles.removeTag}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
          <div>
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => handleTagClick(tag)}
                style={{
                  ...styles.tagButton,
                  ...(selectedTags.includes(tag) ? styles.activeTag : styles.inactiveTag)
                }}
              >
                {tag}
                <span style={{
                  ...styles.tagCount,
                  color: selectedTags.includes(tag) ? 'white' : '#718096'
                }}>
                  ({getTagCount(tag)})
                </span>
              </button>
            ))}
          </div>
        </div>

        <PostsList posts={paginatedPosts} />
      </Wrapper>

      <Pagination
        nbPages={totalPages}
        currentPage={currentPage}
        onChange={setCurrentPage}
      />
    </Layout>
  )
}

export default BlogList

export const pageQuery = graphql`
  query blogListQuery {
    site {
      siteMetadata {
        title
        description
      }
    }
    posts: allMdx(
      sort: { fields: [frontmatter___date], order: DESC }
      filter: {
        fileAbsolutePath: { regex: "//content/posts//" }
        frontmatter: { published: { ne: false }, unlisted: { ne: true } }
      }
    ) {
      edges {
        node {
          excerpt
          timeToRead
          frontmatter {
            title
            tags
            language
            slug
          }
        }
      }
    }
  }
`