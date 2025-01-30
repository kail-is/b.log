import React from 'react'
import { graphql, Link } from 'gatsby'
import styled from 'styled-components'
import Layout from '../components/layout'
import SEO from '../components/SEO'

const TagContainer = styled.div`
  margin: 0 auto;
  padding-top: 5em;
  padding-bottom: 5em;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 40%;
  @media (max-width: 768px) {
    width: 90%;
  }
`


const TagList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: center;
  margin-top: 2em;
`

const Tag = styled.div`
  display: inline-block;
  padding: 9.6px 11.2px;
  margin-top: 8px;
  margin-bottom: 8px;
  border-radius: 50px;
  background-color: #ccc;
  border: 1px solid #aaa;
  color: #fff;
  font-weight: 500;
  text-decoration: none;
  font-size: 14px;
  transition: 0.2s;

  &:hover {
    background-color: #777;
  }
`

const TagsList = ({ data }) => {
  const tags = data.allMdx.distinct

  return (
    <Layout>
      <SEO title="All Tags" />

      <TagContainer>

        <h1>All Tags.</h1>

        <TagList>
          {data.allMdx.group.map(({ fieldValue: tag, totalCount }) => (
            <div key={tag}>
              <Link to={`/tags/${tag}/`} style={{ textDecoration: 'none' }}>
                <Tag>
                  {tag}
                  <span className="count"> ({totalCount})</span>
                </Tag>
              </Link>
            </div>
          ))}
        </TagList>
      </TagContainer>
    </Layout>
  )
}

export const pageQuery = graphql`
  query {
    allMdx {
      group(field: frontmatter___tags) {
        fieldValue
        totalCount
      }
    }
  }
`

export default TagsList
