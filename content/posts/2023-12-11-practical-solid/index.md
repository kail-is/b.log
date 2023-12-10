---
title: SOLID 원칙에 대해 실용적으로 이해하기
slug: practical-SOLID
date: 2023-12-11
cover: ./cover.jpg
generate-card: false
language: ko
tags:
- Java
- OOP
---

“객체지향”이라는 단어를 들었을 때, 어떤 것이 가장 먼저 떠오르는가? 

나에게 가장 먼저 떠오른 것은 SOLID 원칙이다.

이렇게 바로 떠오르는 개념에 대해서는 경계해야 할 부분이 있다. **사람들의 입에서 많이 오르내린 말은 힘이 적다는** 것이다.

중요도에 대해서는 알지만, 실제로 그것을 **구체화해 볼 기회를 적게 가지게 되기 때문**이다.

이는 많이 들었기 때문에 그것을 “이해하고 있다”고 뇌가 착각하기 쉬운 흐름을 가진다.

개념으로만 남은 지식을 정말 활용할 수 있을까?

나는 이러한 사고 흐름에 따라 SOLID 원칙에 대해 직접 코드를 작성해 봄으로써,

해당 원칙을 보다 **“실용적으로” 이해**해 보는 기회를 가지려고 한다.

----

# S: SRP, 단일 책임 원칙

- Single Responsibility Principle

> 하나의 클래스는 하나의 책임만을 가져야 한다


## 책임

- “관련된 기능들을 하나의 `책임`으로 묶어야 한다”
- 하나의 책임
- 하나의 목적

책임이라는 단어는 다소 추상적이다.

내가 생각할 때 책임이라는 단어가 추상적인 이유는, Responsibility의 직역이기 때문도 한몫 하지만,  **책임**이라는 단어가 주체가 아니라 객체의 관점에서 쓰여졌기 때문이라고 생각한다.

나는 그래서 책임이라는 단어를 **목적**이라는 단어로 바꿔서 이해하기를 권해 본다.

> 하나의 클래스는 하나의 목적만을 가져야 한다.

엥? 무슨 말이냐고?

먼저 책임이라는 단어의 용례에 대해 생각해 보자.

책임을 가지는 것에 대해 생각해 보면, 보통 사람을 생각하는 것이 편안하다.

우리가 가지는 책임은 보통 개발하기, 청소하기, 고양이 밥 주기… 등이 있을 것이다.

이 중 가장 편안할(?) 회사(주체)-개발 팀원(객체)의 예시를 생각해 보자.

주체의 입장에서, 회사가 되어 생각해 보자. 이때 책임이라는 단어는 목적으로 바뀐다.

> 회사는 개발팀을 프로그램을 정확하고 빠르게 개발할 목적으로 고용한다.

> 회사는 재무팀을 회사 내 현금 흐름에 대해 정확하게 처리할 목적으로 고용한다.


이제 객체의 입장에서 생각해 보자.

> 회사에서 개발팀은 프로그램을 정확하고 빠르게 개발할 책임을 가진다.


> 회사에서 재무팀은 회사 내 현금 흐름에 대해 정확하게 처리할 책임을 가진다.


개발을 위해 고용된 내가 갑자기 영수증 처리를 맡게 됐다고 생각해 보자.

영수증 처리는 적절한 책임이라고 볼 수 있을까? 아닐 것이다.

객체의 입장에서 책임이라는 단어는, 주체의 입장에서, 그러니까 클래스를 사용하는 우리의 입장에서는 목적이라는 다른 말이 된다.

우리는 하나의 클래스에게 하나의 **목적**을 부여한다.

하나의 클래스는 목적 수행을 위해 하나의 **책임**만을 가져야 한다.

나는 이러한 관점에서 처음 이해할 때에는 **목적이라는 단어가 조금 더 이해하기 쉽다**고 생각한다.

## 미준수 케이스

```java
class Graph {

    private String name;
    private Vector list;

    public Graph(Vector list, String name) {
        this.name = name;
        this.list = list;
    }

    public String draw() {
				String draw = "draw";

				// draw Graph ..

        return draw;
    }

}
```

- 그래프 클래스에서는 그래프 생성 / 그리기를 하나의 클래스에서 하고 있다.
- 하나의 클래스에는 하나의 책임이라는 관점을 지키고 있지 않다.

## 준수 케이스

```java
class Graph {

    private String name;
    private Vector list;

    public Graph(Vector list, String name) {
        this.name = name;
        this.list = list;
    }

}

class GraphDrawer {

    public String draw(Graph graph) {
				String draw = "draw";

				// draw Graph .. 

        return draw;
    }

}
```

- 그래프 생성과 그래프를 그리는 객체가 분리되었다.
- 두 가지 객체는 생성이라는 책임과 / 그림이라는 책임을 나눠서 가진다.
- SRP를 준수했다!

----

# O: OCP, 개방-폐쇄 원칙

- Open/closed principle

> 소프트웨어 요소는 확장에는 열려 있으나 변경에는 닫혀 있어야 한다

## Open / Closed

- 확장에는 열려 있다
    - 클래스의 기능을 자유롭게 **추가**할 수 있어야 한다
- 변경에는 닫혀 있다
    - 해당 클래스를 사용하는 **다른 코드의 변경**에는 닫혀 있다

개방 폐쇄 원칙도 무언가 추상적이다.

확장에는 열려 있고 변경에는 닫혀 있다? 무엇을 확장하고 무엇을 변경한다는 말인가?

나는 이 **확장**이라는 표현을 **(기능) 추가**라고 바꿔서 이해하고 싶다.

클래스의 메서드는 얼마든지 추가될 수 있다. 클래스가 구현하는 인터페이스는 얼마든지 추가될 수 있다.

오케이, 그러면 확장은 됐다. 알 것 같다.

그렇다면 **변경**은? 무엇을 변경하는 것에는 닫혀 있다는 것일까?

**해당 클래스를 기존에 사용하는 곳에서의 변경**에 닫혀 있다는 것이다.

만약 A 클래스의 기능 하나를 수정했다고 해서, A 클래스가 사용되는 모든 메서드를 수정해야 한다면?

상상만 해도 끔찍하고 비효율적이지 않은가.

이제 한번 그 비효율과 효율을 코드로 맛봐 보자.

아까 사용했던 그래프 클래스를 또 가지고 와 보겠다.

## 미준수 케이스

**ver. 1**

```java
class Graph {

    private String name;
    private ArrayList<String> list;

    public Graph(String name, ArrayList<String> list) {
        this.name = name;
        this.list = list;
    }

}

public class SampleProject {

    public static void main(String[] args) {

        String graphName = "MyGraph";
        ArrayList<String> nodeList = new ArrayList<>();
    nodeList.add("Node1");
    nodeList.add("Node2");

    Graph myGraph = new Graph(graphName, nodeList);

    }

}

```

그래프는 지금 `List<String>`만을 인자로 가지고 있다.

**ver. 2**

만약 이 그래프에 Integer를 인자로 가지는 그래프를 추가하고 싶다면?

```java
class Graph {

    private String name;
    private ArrayList<String> list;

    public Graph(String name, Vector<String> list) {
        this.name = name;
        this.list = list;
    }

    public ArrayList<String> getList() {
        return this.list;
    }

}

class IntegerGraph extends Graph{

    private String name;
    private ArrayList<Integer> list;

    public Graph(String name, ArrayList<Integer> list) {
        this.name = name;
        this.list = list;
    }

    @Override
    public ArrayList<Integer> getList() {
        return this.list;
    }

}

public class SampleProject {

    public static void main(String[] args) {

        String graphName = "MyGraph";
        ArrayList<String> nodeList = new ArrayList<>();
		    nodeList.add("Node1");
		    nodeList.add("Node2");

		    Graph myGraph = new Graph(graphName, nodeList);

        ArrayList<String> list = myGraph.getList();

        for (String item : list) {
              System.out.println(item);
        }

        String graphName = "MyGraph2";
        ArrayList<Integer> nodeList = new ArrayList<>();
		    nodeList.add(1);
		    nodeList.add(2);

        for (Integer item : list) {
             System.out.println(item);
        }

    }

}

```

- Graph에 들어가는 타입이 추가될 때마다
    - **Graph 클래스가 추가되어야 한다. → 확장에 열려(?) 있기는 하다.**
    - **호출하는 코드도 변경되어야 한다.  → 변경에도 열려 있다.**

왜?

**getList를 호출하더라도 반환하는 타입이 다르게** 되어 있지 않은가.

그 반환에 대한 값들을 다시 지정해 두어야 한다.

음, 역시 끔찍하다.

이제 조금 더 편안한, 제너릭 개비스콘을 맛보러 가자.

## 준수 케이스


```java

// 변경: Graph 인터페이스의 변경에 닫혀 있다. 
interface Graph<T> {
    void addNode(T node);
    List<T> getList();
}

// 확장: 얼마든지 새로운 타입을 (Double 등) 가지는 그래프를 추가할 수 있다. 
class StringGraph implements Graph<String> {
    private List<String> nodeList = new ArrayList<>();

    @Override
    public void addNode(String node) {
        nodeList.add(node);
    }

    @Override
    public List<String> getList() {
        return nodeList;
    }
}

class IntegerGraph implements Graph<Integer> {
    private List<Integer> nodeList = new ArrayList<>();

    @Override
    public void addNode(Integer node) {
        nodeList.add(node);
    }

    @Override
    public List<Integer> getList() {
        return nodeList;
    }
}

class DoubleGraph implements Graph<Double> {
    private List<Double> nodeList = new ArrayList<>();

    @Override
    public void addNode(Double node) {
        nodeList.add(node);
    }

    @Override
    public List<Double> getList() {
        return nodeList;
    }
}
```

제너릭 인터페이스를 토대로, 확장에는 얼마든지 열려 있지만 변경에는 닫혀 있는 코드를 만들 수 있었다.

---

# L: LSP, 리스코프 치환 원칙

- Liskov Substitution Principle

> 프로그램의 객체는 프로그램의 정확성을 깨뜨리지 않으면서 하위 타입의 인스턴스로 바꿀 수 있어야 한다.

## 치환

리스코프? 리스코프는 컴퓨터 과학자 **Barbara Liskov**의 이름을 따서 만들어졌다고 한다. 즉 이름이다.

그렇지만… 이해하는 입장에서는 이름이 먼저 나오니 역시 직관적이지 않다.

그러니 **치환**이라는 단어에 더더욱 집중해보자.

`치환`은 무엇인가? 바꿀 수 있어야 한다는 이야기다.

무엇이 무엇을 대체할 수 있을까? 설명 개요에서는 하위 타입의 인스턴스라고 했다.

“하위 타입”의 인스턴스라는 것은 자식의 인스턴스를 의미한다.

즉, **자식 객체를 부모 객체로** **완전히 대체**할 수 있어야 한다는 것.

뭘 대체하는지는 알았다. 그렇다면 완전히 대체라는 것이 뭘까? 그냥 바꾸면 돌아가게 하는 것?

**완전하지 못하게 대체하는 케이스**는, 바로 `오버라이딩`<b>을 잘못</b>하는 것이다.

즉, 부모 객체의 함수를 자식 객체가 오버라이딩하면서 기능적인 정확성을 깨 버리는 것이다.

주로 **네 가지 케이스**가 있다.

1. **시그니처 불일치**: 파라미터 / 리턴값의 타입, 개수 변경해 오버라이딩
2. **접근제어자 변경**: 더 좁아지게 만들기 불가능
3. **예외 추가**: 예외 추가 불가능
4. 의도와 다르게 메서드 오버라이딩

자, 개념 정리는 되었다. 하지만 우리는 실용적 이해라고 했으니 코드로 한번 알아보자!

이번에는 더 직관적으로 보기 위해서 부모-자식이라고 클래스 이름을 지어 볼 것이다.

## 미준수 케이스

```java

class Parent {

     public String blahblah(String message) throws Exception {
      System.out.println("Parent: " + message);
      return message;
    }

}

class Child extends Parent {

     @Override
     private void blahblah() throws BusinessException {
        System.out.println("Child: " + message);
    }

}

```

자식이 부모 객체를 오버라이딩하면서… 전부 다 바꿔 버렸다.

접근제어자도 바꿨고, 인자도 사라졌고, 던지는 예외도 바꿔 버렸고,  심지어 리턴 값도 바꿔 버렸다.

이렇게 되면 Parent를 사용하는 곳에서 Child로 바꿨을 때 blahblah 함수에서는 문제가 생길 것이다.

## 준수 케이스

```java

class Parent {

	 public String blahblah(String message) throws Exception {
      System.out.println("Parent: " + message);
			return message;
    }

}

class Child extends Parent {

    @Override
	 public String blahblah(String message) throws Exception{
        System.out.println("Child: " + message);
			return message;
    }

}
```

이 케이스는 LSP를 정확하게 준수한 케이스이다.

문제가 생겼던 접근제어자 / 인자 / 던지는 예외 / 리턴 값 전부 동일하고, 다만 print되는 내용 만이 다르다.

이 경우 Chlid를 Parent로 대체 시에도 프로그램은 문제 없이 정확하게 수행될 것이다.


---

# I: ISP, 인터페이스 분리 원칙

- Interface segregation principle

> 특정 클라이언트를 위한 인터페이스 여러 개가 범용 인터페이스 하나보다 낫다


## 인터페이스 분리

특정 클라이언트를 위한 인터페이스 여러 개?

범용 인터페이스?

나는 이 말을 들었을 때 열 번쯤 다시 읽은 것 같다. 그리고 깨달았다.

**여러 개의 기능을 하나의 인터페이스에 넣지 말라는 뜻이구나!**

인터페이스를 분리함에 있어서, 하나로 모든 걸 **섞어찌개 비빔밥하려고 들지 말라**는 이야기였다.

그리고 그것이 **인터페이스 분리의 기준선**이 되는 거였다.

비빔밥은 비빔밥으로만 두자. 객체지향 프로그래밍에 대입하지 말자.

이번에도 한번 코드로 알아보자.

## 미준수 케이스

유저 인터페이스 안에서 유효성 검사를 적용한 케이스이다.

```java
public interface BiBimBapUser {

    User createUser(String name, String email, String password);
		boolean isNameValid(String name);
		boolean isEmailValid(String email);
		boolean isPasswordValid(String password);

}

public class User implements BiBimBapUser {
    private String username;
    private String password;
		
		@Override
    public User createUser(String name, String email, String password) {
        if (isNameValid(name) && isEmailValid(email) && isPasswordValid(password)) {
            // 유효한 경우에만 User 객체를 생성
            return new User(name, email, password);
        } else {
            // 유효하지 않은 경우에는 예외를 던지거나 다른 처리를 수행할 수 있습니다.
            throw new IllegalArgumentException("Invalid user information");
        }
    }

		@Override 
		public boolean isNameValid(String name) {
				return name != null && !name.trim().isEmpty();
		}
		
    // ...
}

```

**비빔밥 유저 인터페이스** 안에서는 **유저의 생성과 유효성 검사를 함께**하고 있다.

이제 인터페이스 분리 원칙을 적용한 코드를 보자.

## 준수 케이스

```java
public interface UserCreation {
    User createUser(String name, String email, String password);
}

public interface UserValidation {
    boolean isNameValid(String name);
    boolean isEmailValid(String email);
    boolean isPasswordValid(String password);
}

// UserValidation을 담당하는 클래스 따로 생성 
public class UserValidator implements UserValidation {

    @Override
    public boolean isNameValid(String name) {
        return name != null && !name.trim().isEmpty();
    }

    // ...
}

// UserCreation을 담당하는 클래스 따로 생성 
public class UserCreator implements UserCreation {
    private UserValidation validator;

		// UserValidation 주입 (DI) 
    public UserCreator(UserValidation validator) {
        this.validator = validator;
    }

    @Override
    public User createUser(String name, String email, String password) {
        if (validator.isNameValid(name) && validator.isEmailValid(email) && validator.isPasswordValid(password)) {
		        throw new IllegalArgumentException("적절하지 않은 유저 생성입니다.");				
        }

        // 다 끝났어! User를 생성 
				return new User(name, email, password);
    }
}

public class User {
    private String username;
    private String password;
    // ...
}
```

두 가지 인터페이스를 분리한 모습이다.

하나의 인터페이스에서, 한 가지 클래스에서는 한 가지의 일만 하도록 변신했다.

그리고 유저 객체 생성 자체는 유효성 검사와 생성에서 분리되었다.

사실 이 원칙이 다섯 가지 원칙 중에서 가장 직관적인 이름을 가지고 있는 것 같다.

이제 드디어 마지막 시간. 의존 관계 역전 원칙이다.

---

# D: DIP, 의존관계 역전 원칙

- Dependency Inversion Principle

> 프로그래머는 추상화에 의존해야지, 구체화에 의존하면 안된다.

우와. 여전히 무슨 말인지 모르겠다. 또 하나하나 뜯어 보자.

우리가 만약에 인증을 수행하는 기능을 만든다고 생각해 보자.

코드를 짤 때 **인증을 수행하는 방식을 추상화한 인터페이스**를 의존해야 할까,

아니면 **인증 인터페이스를 구체화한 개별 클래스**를 참조해야 할까?

당연히 `추상화된 인터페이스를 참조한다`는 답이 나올 것이다.

그 이야기이다.

클라이언트가 인증 인터페이스를 참조한다면 해당 인터페이스를 참조해야 하고,

인증 하위인 **NaverAuth** / **KakaoAuth**를 참조하면 안 된다는 것.

이건 **자료구조**에서도 마찬가지다.

ArrayList, HashSet 같은 구체 클래스 타입으로 선언하는 것이 아닌,

List나 Set 같은 **인터페이스 타입으로 선언한 다음 참조**하는 것이 DIP의 예시다.

## 의존 관계

그럼 예시는 알겠는데… 이게 의존 관계 역전이라는 이름과 무슨 관련이 있다는 말일까? 의문이 들 수 있다.

그러니 의존 관계에 대해 짚고 넘어가 보자.

의존관계 “역전”을 하려면 **의존관계가 무엇인지 알아야 역전**도 할 것 아닌가.

`의존 관계`란, **하나의 모듈이 다른 모듈의 인터페이스, 클래스, 메소드 등을 사용**하는 관계를 의미한다.

즉, **가져다 쓰는 놈이 의존 관계를 맺고 있는 것**이다.

의존 관계에도 두 가지 관계가 있다. **강결합**과 **약결합**이 그것이다.

넌지시 보면 딴딴하게 붙어 있는 게 더 좋아 보인다. 딴딴하게 붙어야 다른 것도 할 거 아냐.

그런데 객체지향 프로그래밍에서는 다르다. 딴딴히 붙어 있으면… 떼내기 무진장 힘들다.

이와 같이, **참조하는 하나의 모듈이 변경되면 다른 모듈도 변경되어야 하는 관계**를 **강결합**이라고 부른다.

- **강결합**: 취약한 관계
    - 하나의 모듈이 변경되면 다른 모듈이 변경되어야 하는 경우
    - 고수준 모듈(핵심 기능)이 저수준 모듈(프로그래밍적 부수적 요소)에 의존하는 형태

가령, 우리가 `사진 프린터 프로그램`을 만든다고 생각해 보자.

프린터는 여러 가지 드라이버를 가지고 있다.

만약 이 드라이버를 **일일이 다 객체로 생성**해서, **하나하나 인스턴스**를 만드는 걸 **핵심 로직**에서 수행한다면?

**지원 드라이버가 추가될 때마다** 우리는 핵심 로직을 수정하고, 핵심 로직을 테스트해야 할 것이다.

만약 지원 드라이버가 153개쯤 된다면…… **최소 153번 테스트**다. 핵심 로직을. 하나 추가할 때마다.

으악. 생각만 해도 끔찍하지 않은가?

그러니 우리는 **약결합**을 추구해야 한다.

- **약결합**: 핵심 비즈니스 로직은 `추상화`됨, 따라서 핵심 로직은 변경되지 않음
    - 고수준 모듈이 추상화에 의존하는 형태

이게 바로 “의존 관계 역전”이다.

프린트 드라이버는 추상화할 테니까, 니가 맡아서 해라.

**추상화에게 해당 프로그램 제어의 키를 넘겨 버리는 것**이다.

## 역전

- 제어의 역전(Inversion of Control, 역전의 원칙)
- 프로그램의 제어 흐름을 개발자가 아닌 외부의 프레임워크나 컨테이너에게 위임하는 것

설명이 길었다. 이제 한번 코드로 알아보자.

아까 이야기한 인증 클래스로 예시를 들어 보겠다.

## 미준수 케이스

```java
public class Client {

      private KakaoAuth kakaoAuthService;
      private NaverAuth naverAuthService;

    public Client(KakaoAuth kakaoAuthService) {
        this.naverAuthService = authService;
    }

    public Client(NaverAuth naverAuthService) {
        this.naverAuthService = authService;
    }

    public void doSomething(User user) {
        authService.authenticate(user);
        // ...
    }
}

```

해당 코드에서는 서비스를 하나 만들 때마다, 가령 토스 인증이 추가된다면 `TossAuthService`를 만들어야 할 것이고, **doSomething을 테스트**해야 할 것이다.

음, 우리는 배운 사람이다. 그렇게 하지 말자.

## 준수 케이스

```java
public class Client {
		// 이제 아까 생성자로 주입한 것과 같은 것이다! DI! 
    public Client(AuthService authService) {
        this.authService = authService;
    }

    public void doSomething(User user) {
        authService.authenticate(user);
        // ...
    }
}
```

```java
public interface AuthService {
    void authenticate(User user);
}

public class NaverAuth implements AuthService {
    @Override
    public void authenticate(User user) {
        // Naver Auth ..
    }
}

public class KakaoAuth implements AuthService {
    @Override
    public void authenticate(User user) {
        // Kakao Auth ..
    }
}

public class TossAuth implements AuthService {
    @Override
    public void authenticate(User user) {
        // Toss Auth ..
    }
}

```

AuthService를 인터페이스로 뺐다. 이제 토스를 더하고자 할 때는, `TossAuth`를 만들면 될 것이다.

AuthService 인터페이스를 통해서 **구현 방식에 대한 제약**도 생겨났다.

모두가 TossAuth를 만들 때 **같은 메서드**를 쓸 것이다.

굿!

DIP는 다른 원칙에 비해서 많은 것들을 품고 있는 원칙인 것 같다. 통틀어서 말하는 느낌?

추상화와 DI를 한번에 가지고 있으면서 우리에게 외친다.

**추상화를 토대로 한 코드는 유지보수가 쉽다**는 것을. 코드의 수정을 적게 하려면 **무엇을 구조로 빼야 해야하는지**를.

특히 여러 사람, 여러 모듈에서 사용할 때 그 장점은 빛을 발하는 것 같다.

이게 객체 지향 원칙을 지켜야 하는 가장 큰 이유 아닐까.

---

실용적인 방식으로 SOLID를 다시 한번 곱씹어 보면서… 왜 스프링이 객체지향 원칙을 잘 지킨 프레임 워크라고 하는지 다시 한번 절감했다. 특히 추상화, 약결합. DI 면에서 말이다.

다음 번에는 스프링이 어떤 면에서 객체지향 원리를 잘 지켰는지 그 예시에 대해 글을 적어 봐야겠다.

함께 읽어 주신 여러분에게도, 여정으로 가는 좋은 화살표이자 선으로 가는 좋은 점이 되었길 바라면서.

읽어 주셔서 감사합니다.