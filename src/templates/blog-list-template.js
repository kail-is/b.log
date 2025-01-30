import React, { useState, useEffect, useMemo } from 'react'
import { graphql, navigate } from 'gatsby'
import Layout from '../components/layout'
import Wrapper from '../components/Wrapper'
import PostsList from '../components/PostsList'
import Pagination from '../components/Pagination'
import SEO from '../components/SEO'
import config from '../../data/siteConfig'

const HIDDEN_TAGS = config.hiddenTags
const INITIAL_TAGS = config.initialTags
const POSTS_PER_PAGE = 10

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

const BlogList = ({ pageContext, location, data }) => {
  const allPosts = data?.allPosts?.edges || []  // 전체 포스트
  const [selectedTags, setSelectedTags] = useState(() => {
    if (typeof window === 'undefined') return INITIAL_TAGS
    const savedTags = sessionStorage.getItem('selectedTags')
    return savedTags ? JSON.parse(savedTags) : INITIAL_TAGS
  })

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('selectedTags', JSON.stringify(selectedTags))
    }
  }, [selectedTags])
  const currentPage = pageContext.currentPage

  // 1. 전체 태그 목록 (hidden 태그만 제외)
  const allTags = useMemo(() => {
    const tags = new Set()
    allPosts.forEach(post => {
      const postTags = post.node.frontmatter.tags || []
      postTags.forEach(tag => {
        if (!HIDDEN_TAGS.includes(tag)) {
          tags.add(tag)
        }
      })
    })
    return Array.from(tags).sort()
  }, [allPosts])

  // 2. 태그별 카운트 계산 (hidden 태그를 가진 포스트의 다른 태그들도 포함)
  const tagCounts = useMemo(() => {
    const counts = {}
    allPosts.forEach(post => {
      const postTags = post.node.frontmatter.tags || []
      postTags.forEach(tag => {
        if (!HIDDEN_TAGS.includes(tag)) {
          counts[tag] = (counts[tag] || 0) + 1
        }
      })
    })
    return counts
  }, [allPosts])

  // 3. 선택된 태그에 따라 필터링된 전체 포스트
  const filteredPosts = useMemo(() => {
    return allPosts.filter(post => {
      const postTags = post.node.frontmatter.tags || []
      const visibleTags = postTags.filter(tag => !HIDDEN_TAGS.includes(tag))

      if (selectedTags.length === 0) {
        return visibleTags.length > 0
      }
      return selectedTags.some(tag => visibleTags.includes(tag))
    })
  }, [allPosts, selectedTags])

  // 4. 현재 페이지에 보여줄 포스트
  const paginatedPosts = useMemo(() => {
    const startIndex = (currentPage - 1) * POSTS_PER_PAGE
    return filteredPosts.slice(startIndex, startIndex + POSTS_PER_PAGE)
  }, [filteredPosts, currentPage])

  // 5. 전체 페이지 수 계산
  const totalPages = Math.ceil(filteredPosts.length / POSTS_PER_PAGE)

  // 필터링된 결과가 변경될 때마다 체크
  useEffect(() => {
    if (filteredPosts.length <= POSTS_PER_PAGE && currentPage !== 1) {
      navigate('/')
    }
  }, [filteredPosts.length, currentPage])

  return (
    <Layout location={location}>
      <SEO />
      <Wrapper>
        {/* 태그 목록 */}
        <div style={styles.filterSection}>
          <div style={styles.filterHeader}>
            <span>Tags</span>
            {selectedTags.length > 0 && (
              <button onClick={() => setSelectedTags([])} style={styles.removeTag}>
                ✕
              </button>
            )}
          </div>
          <div>
            {allTags.map(tag => (
              <button
                key={tag}
                onClick={() => setSelectedTags(prev =>
                  prev.includes(tag)
                    ? prev.filter(t => t !== tag)
                    : [...prev, tag]
                )}
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
                  ({tagCounts[tag] || 0})
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 포스트 목록 */}
        <PostsList posts={paginatedPosts} />
      </Wrapper>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <Pagination
          nbPages={totalPages}
          currentPage={currentPage}
          onChange={(newPage) => {
            navigate(newPage === 1 ? '/' : `/pages/${newPage}`, {
              state: { selectedTags }
            })
          }}
        />
      )}
    </Layout>
  )
}

export default BlogList

// GraphQL로 전체 포스트 데이터 가져오기
export const pageQuery = graphql`
  query blogListQuery {
    allPosts: allMdx(
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