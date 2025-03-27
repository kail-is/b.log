---
title: "Test - Mock 객체와 활용"
slug: mock-diff
date: 2025-03-27
cover: ../../images/sea.jpeg
generate-card: false
language: ko
tags:
- F-lab
- BE
---

> 인프런에서 진행한 워밍업 클럽 스터디 - 테스트 코드 / 클린 코드를 수강하며 들었던 내용을 정리합니다.

# @Mock, @MockBean, @Spy, @SpyBean, @InjectMocks 의 차이

| 어노테이션 | 프레임워크 | 동작 방식 | 주요 특징 |
| --- | --- | --- | --- |
| `@Mock` | Mockito | 가짜(mock) 객체 생성 | 메서드 호출 시 기본적으로 **아무 동작도 하지 않음** |
| `@MockBean` | Spring + Mockito | 가짜(mock) 객체 생성 | Spring Context에 주입됨 (예: `@Service`, `@Repository` 등) |
| `@Spy` | Mockito | 실제 객체를 감싸는 spy 생성 | 기본적으로 실제 객체 동작 유지, 일부 메서드만 스텁 가능 |
| `@SpyBean` | Spring + Mockito | 실제 객체를 감싸는 spy 생성 | Spring Context에 주입됨 |
| `@InjectMocks` | Mockito | Mock 객체들을 테스트 대상 객체에 주입 | `@Mock`, `@Spy`가 붙은 객체들을 해당 필드에 자동으로 주입 |


# 테스트 코드 구현하기

✔️ 게시판 게시물에 달리는 댓글을 담당하는 Service Test
✔️ 댓글을 달기 위해서는 게시물과 사용자가 필요하다.
✔️ 게시물을 올리기 위해서는 사용자가 필요하다.


## 구현 필요 내용

* 사용자가 댓글을 작성할 수 있다.
* 사용자가 댓글을 수정할 수 있다.
* 자신이 작성한 댓글이 아니면 수정할 수 없다.

=> User / Post / Comment 객체 필요
=> User / Post / Comment 저장소 필요

- User - Comment - 1:N 구조
- User - Post - 1:N 구조


| **구분** | **설명** |
|----------|----------|
| **테스트 대상** | 댓글 작성 및 수정 기능을 검증하는 서비스 테스트 |
| **필요한 객체** | `UserService`, `PostService`, `CommentService`, `User`, `Post`, `Comment` |
| **의존성 관리** | `@Mock`을 사용하여 `UserRepository`, `PostRepository`, `CommentRepository`를 Mocking |
| **테스트 대상 객체** | `@InjectMocks`를 사용하여 `CommentService`를 주입 |

---

## 객체 초기화

```java
@ExtendWith(MockitoExtension.class)
class CommentServiceTest {

    @Mock
    private UserRepository userRepository;
    
    @Mock
    private PostRepository postRepository;
    
    @Mock
    private CommentRepository commentRepository;
    
    @InjectMocks
    private CommentService commentService; 

    private User user;
    private Post post;
    private Comment comment;
    
```

* 상기해 둔 데이터 세팅 


## BeforeEach

```java
    
    @BeforeEach
    void setUp() {
        user = new User(1L, "testUser", "password");
        post = new Post(1L, "게시물 제목", "게시물 내용", user);
        comment = new Comment(1L, "댓글 내용", user, post);
        
        when(userRepository.findById(1L)).thenReturn(Optional.of(user));
        when(postRepository.findById(1L)).thenReturn(Optional.of(post));
        when(commentRepository.save(any(Comment.class))).thenAnswer(invocation -> invocation.getArgument(0));
    }
```

* 공통 사용자 1명 생성 - 불필요한 사용자 세팅을 하는 것은 비효율적

---

### **2. 댓글 작성 테스트 (`writeComment`)**
```java
@DisplayName("사용자가 댓글을 작성할 수 있다.")
@Test
void writeComment() {
    // given
    Long userId = 1L;
    Long postId = 1L;
    String commentContent = "새로운 댓글";

    when(userRepository.findById(userId)).thenReturn(Optional.of(user));
    when(postRepository.findById(postId)).thenReturn(Optional.of(post));

    // when
    Comment savedComment = commentService.writeComment(userId, postId, commentContent);

    // then
    assertNotNull(savedComment);
    assertEquals(commentContent, savedComment.getContent());
    assertEquals(user, savedComment.getUser());
    assertEquals(post, savedComment.getPost());
}
```

* given 필요한 상황 주입 

---

### **3. 댓글 수정 테스트 (`updateComment`)**
```java
@DisplayName("사용자가 댓글을 수정할 수 있다.")
@Test
void updateComment() {
    // given
    Long userId = 1L;
    Long commentId = 1L;
    String updatedContent = "수정된 댓글 내용";

    when(commentRepository.findById(commentId)).thenReturn(Optional.of(comment));

    // when
    commentService.updateComment(userId, commentId, updatedContent);

    // then
    assertEquals(updatedContent, comment.getContent());
}
```

---

### **4. 댓글 수정 권한 체크 (`cannotUpdateCommentWhenUserIsNotWriter`)**
```java
@DisplayName("자신이 작성한 댓글이 아니면 수정할 수 없다.")
@Test
void cannotUpdateCommentWhenUserIsNotWriter() {
    // given
    User anotherUser = new User(2L, "다른 사용자", "password");
    Long commentId = 1L;
    String updatedContent = "수정하려는 댓글";

    when(commentRepository.findById(commentId)).thenReturn(Optional.of(comment));

    // when & then
    assertThrows(IllegalArgumentException.class, () -> 
        commentService.updateComment(anotherUser.getId(), commentId, updatedContent)
    );
}
```

---

### **정리**
- **`@BeforeEach`**
  - 테스트에 필요한 `User`, `Post`, `Comment`를 생성
  - Mock 객체의 동작을 미리 정의

- **댓글 작성 테스트 (`writeComment`)**
  - 정상적으로 댓글이 저장되는지 확인

- **댓글 수정 테스트 (`updateComment`)**
  - 댓글 내용이 정상적으로 변경되는지 확인

- **댓글 수정 권한 체크 (`cannotUpdateCommentWhenUserIsNotWriter`)**
  - 작성자가 아닌 사용자가 수정하려 하면 예외 발생 여부 확인

---