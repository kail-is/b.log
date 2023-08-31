import React, { Fragment } from 'react'
import styled from 'styled-components'
import TagList from './TagList'
import Translations from './Translations'
import Time from './Time'
import { Bull } from './Commons'

const Header = styled.header`
  margin-bottom: 5rem;
  color: var(--color-textSecondary);
  font-size: 0.9em;
`
const HeroTitle = styled.h1`
  font-weight: 700;
  letter-spacing: -3.5px;
  font-size: 2rem;
  margin: 0; 
  padding-bottom: 10px;
  color: var(--color-postTitle);
`


class ContentIntro extends React.Component {
  render() {
    const { title, date, tags, translations } = this.props

    return (
      <Header>
        <HeroTitle>{title}</HeroTitle>
        {date && <Time date={date} />}
        {date && Array.isArray(tags) && tags.length > 0 && <Bull />}
        {Array.isArray(tags) && tags.length > 0 && (
          <Fragment>
            <TagList tags={tags} />
          </Fragment>
        )}

        {/* {translations && <Translations translations={translations} />} */}
      </Header>
    )
  }
}

export default ContentIntro
