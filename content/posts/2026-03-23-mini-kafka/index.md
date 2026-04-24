---
title: "Mini Kafka 직접 구현하기: Outbox 다음 단계에서 본 메시지 큐 구조"
slug: mini-kafka
date: 2026-03-23
cover: ../../images/sea.jpeg
generate-card: false
language: ko
tags:
- BE
- Kafka
- MQ
---

> 지금 맡은 서비스 환경에서는 MQ를 붙이는 것이 오버엔지니어링이지만, 조건이 같다면 분명 MQ를 써야 할 장면들이 많다. 특정 시기 때는 Kafka 쓰면 된다, 라고 인지하고 있음을 말하는 대신, 직접 메시지 큐를 만들어 보며 감을 다듬고 싶었다. Mini Kafka는 제약을 뛰어넘어 어떻게든 MQ를 설계해 보려는 시도다.

---

- **이번 글에서 확인한 흐름**
  - Topic → Producer → Consumer → Partition → Replication → Consumer Group → Offset 순서로 Mini Kafka를 뜯어본다.
  - 각 섹션에서 문제 가설 → 실험/구현 → 의사결정 로그 → 트래픽 이슈 대응 포인트를 정리했다.

- **시리즈 함께 보기**
  - [Mini Redis 직접 구현하기: Geo 캐시까지 꿰뚫어 보기](/mini-redis) — 메시지가 큐를 타고 나간 뒤 Redis 캐시에 반영되는 흐름까지 이어지는 후속 글.

- **바로가기**
  - [Mini Kafka를 다시 만든 이유](#mini-kafka를-다시-만든-이유)
  - [1. Topic](#1-topic)
  - [2. Producer](#2-producer)
  - [3. Consumer](#3-consumer)
  - [4. Partition](#4-partition)
  - [5. Replication](#5-replication)
  - [6. Consumer Group](#6-consumer-group)
  - [7. Offset](#7-offset)
  - [마무리](#마무리)

---

## Mini Kafka를 만든 이유

Outbox 패턴은 "이벤트를 안전하게 DB에 남긴다"까지만 책임진다. 하지만 실제 운영 환경에서는 이벤트가 곧바로 외부 시스템으로 흘러가야 한다. "왜 Topic이 필요한가?", "왜 Consumer Group을 써야 안전한가?"를 내 입으로 설명하려면 실증이 필요했다. 문서만 읽고서는 항상 어딘가를 짚지 못한 느낌이 남아서 아쉬웠다.

처음에는 Kafka 공식 문서와 블로그 글을 읽으면서 개념을 익혔다. 하지만 문서를 읽는 것과 실제로 부딪히는 것은 완전히 다른 경험이었다. 예를 들어, "Consumer Group이 리밸런싱된다"라는 문장은 이해했지만, 리밸런싱이 왜 위험한지, 언제 발생하는지, 어떻게 대응해야 하는지는 직접 겪어보기 전까지 감이 없었다.

그래서 아래 원칙을 세우고 직접 구현해 봤다.

1. **문제 가설부터 명시한다.** 설계 전에 "어떤 상황에서 병목이 생길까"를 먼저 적고, 구현 중 해당 현상이 실제로 나타나는지 검증한다.
2. **의사결정 로그를 남긴다.** 설계 선택 이유와 포기한 대안까지 기록한다. "왜 A가 아닌 B를 선택했는가"를 나중에 설명할 수 있어야 한다.
3. **발견과 감정을 분리한다.** 무슨 근거로 어떤 결론을 얻었는지 명확히 쓰고, 마지막에 느낀 점을 정리한다.
4. **트래픽 이슈 대응 관점으로 정리한다.** 구현을 마친 후 "실제 장애가 나면 어떤 순서로 점검할 것인가"를 적는다.

아래는 Topic → Producer → Consumer → Partition → Replication → Consumer Group → Offset 순서로 정리한 내용이다. 각 섹션은 **왜 고민했나 → 예상한 문제 → 구현하며 확인한 것 → 의사결정 과정 → 트래픽 이슈 대응 포인트 → 느낀 점 → 코드** 순서를 따른다.

---

## 1. Topic

### 왜 이걸 고민했나

Outbox만 있는 시스템에서 주문/결제/알림 이벤트가 한 큐에 들어가면 어떤 일이 생길까? 특정 도메인의 장애가 다른 도메인으로 전파될 것 같았다. 이런 상황에서 Topic 분리가 정말 필요한지 직접 확인하고 싶었다.

"Topic을 나누자"고 주장하려면 그 근거를 스스로 만들어야 했다. "Kafka에서는 원래 이렇게 한다"라는 말로는 부족했다. Topic을 왜 나눠야 하는지, 어떤 기준으로 나눠야 하는지, 나누면 뭐가 좋아지는지를 코드로 증명하고 싶었다.

### 어떤 문제를 예상했나

**가설 1. 장애 전파 범위**

서로 다른 도메인이 같은 큐를 쓰면, 특정 기능의 장애가 전체 Consumer에게 전파될 것이라 예상했다. 예를 들어, 결제 처리 로직에서 예외가 발생하면 해당 메시지에서 Consumer가 멈추고, 뒤에 쌓인 알림 메시지들도 처리되지 않는 상황이 생길 것이다.

이 가설을 검증하기 위해 의도적으로 Consumer 스레드를 30초간 블로킹시키는 실험을 했다. 그 사이 알림 메시지 500개가 밀리는 모습을 보고, "주문과 알림이 같은 큐에 있으면 이런 일이 생기겠구나"라는 확신을 얻었다.

**가설 2. 레이스 컨디션**

Topic을 동적으로 만들다 보면 동시에 같은 이름으로 생성 요청이 들어올 수 있다. 이 경우 기존 Topic 참조가 덮어씌워지면서 메시지가 유실될 위험이 있다고 정리했다.

이 가설은 `mutableMapOf`로 Topic을 관리하는 초기 설계를 보면서 떠올렸다. `map[name] = Topic(name)`을 두 스레드가 동시에 실행하면 어떻게 될까? 먼저 생성된 Topic 인스턴스에 이미 메시지가 쌓여 있는데, 두 번째 스레드가 새 인스턴스로 덮어쓰면 그 메시지들은 어디로 가는 걸까?

### 구현하며 확인한 것

**확인 1. 레이스 컨디션 시뮬레이션**

`mutableMapOf`와 `synchronized`로 Topic을 관리하면 동시성 문제가 생길 것 같았다. 확인하기 위해 100개의 스레드가 동시에 `createTopic("orders")`를 호출하는 부하 테스트를 만들었다.

```kotlin
// 테스트 대상 코드
private val topics = mutableMapOf<String, Topic>()

fun createTopic(name: String): Topic {
    synchronized(topics) {
        if (!topics.containsKey(name)) {
            topics[name] = Topic(name)
        }
        return topics.getValue(name)
    }
}
```

예상대로 `synchronized` 블록 바깥에서 `topics[name]`을 읽는 코드가 있으면 쓰기와 읽기가 동시에 일어나면서 불일치가 발생했다.

**확인 2. `ConcurrentHashMap` + `computeIfAbsent`**

동시성 문제를 피하려면 `ConcurrentHashMap`과 `computeIfAbsent` 조합이 자연스럽다. `computeIfAbsent`는 키가 없을 때만 람다를 실행하고, 이 과정이 원자적으로 이루어진다.

```kotlin
private val topics = ConcurrentHashMap<String, Topic>()

fun createTopic(name: String, partitionCount: Int = 1): Topic =
    topics.computeIfAbsent(name) { Topic(it, partitionCount) }
```

같은 부하 테스트를 100만 번 반복해도 문제가 발생하지 않았다.

**확인 3. Topic 분리의 효과를 수치로 확인했다**

주문/결제/정산 Topic을 분리하고 각각에 부하를 걸어봤다. 결제 Topic의 Consumer를 의도적으로 느리게 만들어 지연을 유발했을 때, 주문과 정산 Topic의 처리량은 영향을 받지 않았다. 반면 단일 Topic으로 운영했을 때는 결제 지연이 발생하면 모든 이벤트의 처리가 느려졌다.

| 구성 | 결제 지연 발생 시 주문 처리량 | 결제 지연 발생 시 알림 지연 |
|------|------------------------------|---------------------------|
| 단일 Topic | 32% 감소 | 평균 4.7초 |
| 분리 Topic | 영향 없음 | 영향 없음 |

### 의사결정 과정

**대안 1. 단일 Topic + 이벤트 타입별 분기**
장점은 단순함이다. Topic 관리 오버헤드가 없고, 모든 이벤트를 한 곳에서 볼 수 있다.
단점은 장애 전파와 코드 복잡도다. 위에서 실험한 대로 한 도메인의 문제가 다른 도메인에 영향을 준다.

**대안 2. 도메인별 Topic 분리**
장점은 장애 격리와 코드 분리다. 각 Consumer가 자기 도메인만 책임지니 코드도 단순해진다.
단점은 Topic 관리 복잡도다. Topic이 많아지면 모니터링 대상도 늘어난다.

**최종 선택. 도메인별 Topic 분리**
장애 격리의 이점이 관리 복잡도보다 크다고 판단했다. 특히 "결제 장애가 알림에 영향을 주면 안 된다"는 비즈니스 요구사항이 명확했기 때문이다.

Topic을 나눌 때 기준으로 삼은 것:
1. **SLA가 다른가?** 결제는 3초 내 응답, 알림은 1분 내 전송이 목표였다. SLA가 다르면 분리한다.
2. **담당 조직이 다른가?** 결제팀과 마케팅팀이 같은 Consumer를 수정하면 배포 충돌이 생긴다.
3. **장애 전파를 막아야 하는가?** 한쪽 장애가 다른 쪽에 영향을 주면 안 되는 경우 분리한다.

### 트래픽 이슈 대응 포인트

이 구현을 통해 Topic 관련 장애가 발생했을 때 아래 순서로 점검할 수 있게 됐다.

1. **어떤 Topic에서 문제가 발생했나?** 분리된 Topic이면 영향 범위를 빠르게 파악할 수 있다.
2. **Topic 생성 시점에 레이스 컨디션이 있었나?** `ConcurrentHashMap`을 쓰고 있다면 이 가능성은 낮다.
3. **Topic 분리 기준이 적절한가?** 한 Topic의 장애가 다른 곳에 영향을 주고 있다면 분리 기준을 재검토한다.

### 느낀 점

이 접근을 정리하면 "Topic 수를 어떻게 정할지"라는 질문에 서비스별 SLA, 소유 조직, 장애 전파 면적 같은 지표로 답할 수 있다. "결제 지연이 알림에 영향을 주지 않으려면 분리해야 한다"처럼 요구사항을 수치화해 기준으로 삼는다.

Topic 생성을 동적 API로 열어두면 비슷한 이름의 Topic이 중복 생성되는 실수가 발생할 수 있다. `orders`, `order`, `Orders`가 각각 다른 Topic으로 만들어지는 상황을 막으려면 생성 시점에 네이밍 컨벤션을 검증하거나, 메타데이터(담당팀, 목적, 예상 처리량)를 필수 입력으로 받는 편이 안전하다.

### 실습으로 확인한 것

위에서 `ConcurrentHashMap`으로 문제를 해결했다고 적었지만, 솔직히 "왜 안전한지"를 피부로 느끼지는 못했다. 그래서 100개 스레드가 동시에 같은 key로 Topic을 생성하는 부하 테스트를 직접 돌려봤다.

`HashMap` + `containsKey/put` 조합으로 했더니 **100개 중 29개만** 들어갔다. 71개가 증발한 것이다. `containsKey`가 false를 반환한 뒤 `put`을 실행하기 전에 다른 스레드가 끼어들어 새 리스트로 덮어쓰는 구조였다. 머리로는 알고 있었지만, 숫자로 보니까 다르다. 100번 시도해서 29번만 성공한다는 건 운영 환경에서는 "언제 터질지 모른다"는 뜻이다.

`ConcurrentHashMap.computeIfAbsent()`로 바꾸니 항상 100개가 들어갔다. 여기서 궁금했던 건 "그러면 결국 synchronized를 쓰는 건데, 성능은 괜찮은가?"였다. 확인해 보니 ConcurrentHashMap은 테이블 전체를 잠그지 않고 **해당 키가 속한 버킷만** 잠근다. 버킷이 기본 16개이므로 최대 16개 스레드가 서로 다른 버킷에 동시에 쓸 수 있다. "synchronized를 지양하라"는 말을 자주 듣지만, 정확히는 **범위를 크게 잡지 말라**는 뜻이었다. 작게 잡으면 오히려 가장 확실한 방법이다.

### 코드

```kotlin
class Broker<T> {
    private val topics = ConcurrentHashMap<String, Topic<T>>()

    fun createTopic(name: String, partitionCount: Int = 1): Topic<T> =
        topics.computeIfAbsent(name) { Topic(it, partitionCount) }

    fun getTopic(name: String): Topic<T>? = topics[name]

    fun listTopics(): List<String> = topics.keys().toList()

    fun deleteTopic(name: String): Boolean = topics.remove(name) != null
}
```

---

## 2. Producer

### 왜 이걸 고민했나

Outbox 테이블에 INSERT하고 같은 트랜잭션에서 메시지를 발행하는 구조를 쓰고 있었다. 코드로 보면 이랬다.

```kotlin
@Transactional
fun createOrder(order: Order) {
    orderRepository.save(order)
    outboxRepository.save(OutboxEvent(order.toEvent()))
    producer.send("orders", order.toEvent())  // 여기서 실패하면?
}
```

문제는 `producer.send()`에서 예외가 발생하면 전체 트랜잭션이 롤백된다는 것이었다. 주문 데이터도, Outbox 레코드도 모두 사라진다. 그러면 클라이언트에게 "주문 실패"를 응답하고 재시도를 유도해야 하는데, 실제로는 Kafka가 잠깐 느려진 것뿐이라 재시도하면 중복 주문이 생길 수 있다.

이 구조에서는 장애가 발생했을 때 "DB가 문제인지 Kafka가 문제인지"를 분리하기 어렵다. 로그에는 `Connection refused`, `Timeout` 같은 메시지가 섞여 나타나는데, 이게 DB 커넥션 문제인지 Kafka 브로커 문제인지 한눈에 식별하기 힘들다.

### 어떤 문제를 예상했나

**가설 1. 무한 재시도 루프**

`send()`에서 예외가 나면 트랜잭션이 롤백되고, Outbox 폴러가 다시 해당 레코드를 읽어서 재시도한다. 그런데 Kafka가 계속 응답하지 않으면? 롤백 → 재시도 → 롤백 → 재시도의 무한 루프가 발생할 것이다.

이 가설은 Kafka 응답을 의도적으로 30분 동안 막아둔 실험에서 확인됐다. 그 사이 Outbox 폴러가 같은 메시지를 수천 번 재시도하면서 DB 커넥션 풀을 고갈시켰다.

**가설 2. 재시도 정책 변경의 어려움**

Producer가 비즈니스 로직과 강하게 결합되어 있으면, 재시도 정책을 바꾸거나 DLQ(Dead Letter Queue)를 붙이는 게 어려울 것이다. 예를 들어 "3번 실패하면 DLQ로 보내자"라는 정책을 추가하려면 비즈니스 코드를 수정해야 한다.

**가설 3. 메시지 순서 문제**

같은 주문 ID에 대한 이벤트(생성 → 결제 → 배송)가 여러 파티션에 흩어지면 순서가 뒤바뀔 수 있다. Consumer가 "배송" 이벤트를 먼저 받고 "생성" 이벤트를 나중에 받으면 로직이 깨진다.

### 구현하며 확인한 것

**확인 1. 무한 루프가 실험으로 확인됐다**

테스트 환경에서 Kafka 브로커를 강제로 중단시키고 Outbox 폴러를 돌렸다. 예상대로 아래 루프가 발생했다.

```
[10:00:01] Polling outbox... found 1 message
[10:00:01] Sending to Kafka... failed (Connection refused)
[10:00:01] Transaction rolled back
[10:00:02] Polling outbox... found 1 message (같은 메시지)
[10:00:02] Sending to Kafka... failed (Connection refused)
[10:00:02] Transaction rolled back
... (무한 반복)
```

CPU 사용률이 100%까지 치솟았고, DB 커넥션 풀이 고갈되어 다른 API 요청도 실패하기 시작했다.

**확인 2. Producer 분리가 답이었다**

Producer를 Outbox 트랜잭션과 완전히 분리했다. Outbox 폴러는 메시지를 읽어서 Producer에게 전달만 하고, 성공/실패 여부와 관계없이 해당 레코드를 "처리 중"으로 표시한다. Producer는 비동기로 메시지를 전송하고, 실패하면 DLQ Topic으로 보낸다.

```kotlin
// 개선된 구조
class OutboxPoller {
    fun poll() {
        val messages = outboxRepository.findPending()
        for (message in messages) {
            outboxRepository.markAsProcessing(message.id)
            producer.sendAsync(message)  // Fire-and-forget
        }
    }
}

class Producer {
    fun sendAsync(message: OutboxMessage) {
        try {
            broker.getTopic(message.topic)?.let { topic ->
                topic.selectPartition(message.key).publish(message)
            }
        } catch (e: Exception) {
            broker.getTopic("dlq")?.selectPartition(null)?.publish(message)
        }
    }
}
```

이 구조에서는 Kafka가 응답하지 않아도 Outbox 폴러는 멈추지 않는다. 실패한 메시지는 DLQ에 쌓이고, 나중에 운영자가 수동으로 재처리하거나 별도 Consumer가 처리한다.

**확인 3. key 기반 파티셔닝으로 순서 보장**

같은 주문 ID를 key로 사용하면 해당 주문의 모든 이벤트가 같은 파티션에 들어간다. 파티션 내에서는 순서가 보장되므로, Consumer는 항상 "생성 → 결제 → 배송" 순서로 이벤트를 받는다.

```kotlin
producer.send(topicName = "orders", key = order.id, message = event)
```

### 의사결정 과정

**대안 1. 동기 전송 + 트랜잭션 묶기**
장점: 단순하다. 메시지 전송 실패 시 전체가 롤백되므로 "전송되지 않은 메시지"가 Outbox에 남지 않는다.
단점: Kafka 장애가 비즈니스 로직에 직접 영향을 준다. 위에서 본 무한 루프 문제가 발생한다.

**대안 2. 비동기 전송 + DLQ**
장점: Kafka 장애가 비즈니스 로직과 분리된다. 실패한 메시지만 DLQ에 격리되어 나머지는 정상 처리된다.
단점: DLQ 모니터링과 재처리 로직이 추가로 필요하다.

**최종 선택. 비동기 전송 + DLQ**
"주문 생성"은 성공했는데 "주문 이벤트 전송"만 실패한 경우, 고객에게는 "주문 완료"를 보여주고 이벤트는 나중에 재처리하는 게 더 나은 UX라고 판단했다. DLQ 모니터링 대시보드를 만드는 비용보다 "주문이 자꾸 실패해요"라는 CS 비용이 더 크다.

### 트래픽 이슈 대응 포인트

Producer 관련 장애가 발생했을 때 아래 순서로 점검한다.

1. **DLQ에 메시지가 쌓이고 있나?** DLQ 모니터링 대시보드를 확인한다.
2. **어떤 Topic으로 전송이 실패했나?** DLQ 메시지의 원본 Topic을 확인한다.
3. **key가 null인 메시지가 있나?** 순서가 중요한 메시지인데 key가 없으면 파티션이 랜덤 배정되어 순서가 꼬일 수 있다.
4. **Kafka 브로커 상태는 정상인가?** 브로커 메트릭(CPU, 메모리, 디스크)을 확인한다.

### 느낀 점

Producer를 Fire-and-forget으로 만들면 "장애 지점"을 명확히 분리할 수 있다. DLQ에 실패한 메시지가 모여 있으니 원인 파악은 DLQ부터 확인하면 된다.

DLQ를 붙여두면 파티션 장애가 나더라도 어떤 메시지가 영향을 받았는지 추적하기 쉽다. DLQ에 쌓인 개수만 세도 영향 범위를 빠르게 추산할 수 있다.

한 가지 더 짚고 가자면, Outbox 패턴은 Kafka 전용이 아니다. 처음에는 "Outbox로 Kafka를 트리거한다"고 생각했는데, 정확히는 "DB 트랜잭션과 외부 시스템 호출을 분리한다"가 본질이었다. 외부 시스템이 MQ든 HTTP든 Slack이든 상관없다. 최종 안전장치는 항상 Outbox 테이블(DB)이다. Kafka가 죽어도, DLQ도 못 보내도, DB에 메시지가 남아있으니까 살아나면 폴러가 다시 시도하면 된다.

### 실습으로 확인한 것

**배치 전송.** 실제 Kafka Producer는 `send()`를 호출해도 바로 네트워크로 보내지 않는다. 배치에 모았다가 한꺼번에 보낸다. 이걸 직접 구현해서 돌려봤더니, `send()` 20번 호출에 실제 네트워크 전송은 4번뿐이었다. 5개씩 모아서 한 번에 보내니까 네트워크 호출 횟수가 1/5로 줄었다.

여기서 궁금했던 건 "옵션을 바꾸면 얼마나 차이가 나는가"였다. 100개 메시지를 보낼 때 `batch.size=20`이면 네트워크 5번, `batch.size=1`이면 100번이었다. `linger.ms`도 재밌었는데, 0이면 메시지 오자마자 즉시 전송하고, 50이면 50ms 기다리면서 더 모은다. 결국 지연 vs 처리량의 트레이드오프다. 결제처럼 빨리 보내야 하는 건 `linger.ms=0`, 로그처럼 좀 밀려도 되는 건 `linger.ms=50`으로 모아서 보내는 게 맞다.

| | 처리량 우선 (로그, 이벤트) | 안정성 우선 (결제, 주문) |
|---|---|---|
| batch.size | 65536 (크게) | 16384 (기본값) |
| linger.ms | 50~100 | 0 |
| acks | 0 | all |
| retries | 0 | 3+ |

**파티션 단위 배치.** 미니 Kafka에서는 배치를 토픽 단위로 모았지만, 실제 Kafka Producer는 파티션 단위로 모은다. 처음에는 "왜 굳이?"라고 생각했는데, 이유는 단순했다. 파티션마다 리더 브로커가 다를 수 있기 때문이다. P0의 리더가 브로커 A이고 P1의 리더가 브로커 B라면, 보내는 목적지가 다르니까 같은 배치로 묶을 수가 없다. 파티션별로 모아야 같은 브로커로 갈 메시지끼리 한 번의 네트워크 요청으로 보낼 수 있다.

**TCP 통신.** 그런데 여기서 하나 놓치고 있던 게 있었다. Producer와 Broker 사이의 "네트워크 전송"이 정확히 뭘 의미하는지를 깊이 생각해 본 적이 없었다. 같은 서버에 Kafka를 띄워도 Producer와 Broker는 별도 프로세스다. 프로세스가 다르면 메모리 공간이 독립적이라 직접 접근할 방법이 없다. `localhost:9092`로 접속하는 것도 loopback 인터페이스를 통한 TCP 소켓 통신이다. 이건 Kafka만 그런 게 아니라 MySQL(`localhost:3306`), Redis(`localhost:6379`) 전부 같은 구조다.

TCP 연결을 맺을 때 3-way handshake로 패킷 3번 왕복하는 비용이 있다. 그래서 매번 연결을 새로 맺지 않고 커넥션 풀로 미리 연결을 만들어놓고 재사용한다. 스프링의 HikariCP가 DB 커넥션을 풀링하는 이유가 이것이고, Kafka Producer 내부에서도 브로커별로 커넥션을 관리하는 이유가 같다. "커넥션 풀이 뭐냐"는 질문에 "TCP 연결 재사용"이라고 답할 수 있게 된 건 이 지점에서였다.

### 코드

```kotlin
class Producer<T>(private val broker: Broker<T>) {
    fun send(topicName: String, key: String?, message: T) {
        val topic = broker.getTopic(topicName)
            ?: throw IllegalArgumentException("Topic not found: $topicName")

        val partition = topic.selectPartition(key)
        partition.publish(message)
    }

    fun sendAsync(topicName: String, key: String?, message: T) {
        runCatching { send(topicName, key, message) }
            .onFailure { error -> sendToDlq(message, topicName, error) }
    }

    private fun sendToDlq(message: T, originalTopic: String, error: Throwable) {
        val dlqMessage = DlqMessage(
            original = message,
            originalTopic = originalTopic,
            errorMessage = error.message,
            failedAt = System.currentTimeMillis()
        )
        broker.getTopic(DLQ_TOPIC_NAME)?.selectPartition(null)?.publish(dlqMessage as T)
    }

    companion object {
        private const val DLQ_TOPIC_NAME = "dlq"
    }
}

data class DlqMessage<T>(
    val original: T,
    val originalTopic: String,
    val errorMessage: String?,
    val failedAt: Long
)
```

---

## 3. Consumer

### 왜 이걸 고민했나

초기 Consumer 구현은 단순했다. `while(true)` 루프 안에서 큐를 계속 polling하는 구조였다.

```kotlin
// 초기 구현 (문제 있음)
while (true) {
    val message = queue.poll()
    if (message != null) {
        process(message)
    }
}
```

이 코드를 돌렸을 때 CPU 사용률이 400%까지 치솟았다. 큐에 메시지가 없어도 `poll()`을 쉬지 않고 호출하니 당연한 결과였다. "그러면 `Thread.sleep()`을 넣으면 되지 않나?"라고 생각했지만, sleep 시간을 얼마로 잡아야 하는지가 문제였다.

"Consumer 스레드를 늘리면 해결되지 않나?"라는 생각이 들었지만, 스레드를 늘려도 각 스레드가 CPU를 100%씩 먹으면 의미가 없다는 걸 직접 확인하고 싶었다.

### 어떤 문제를 예상했나

**가설 1. sleep 시간과 지연의 trade-off**

`Thread.sleep(1)`을 넣으면 CPU는 낮아지겠지만, 그 1ms 동안 들어온 메시지는 다음 루프까지 처리되지 않는다. sleep 시간을 10ms, 100ms로 늘리면 CPU는 더 낮아지지만 메시지 처리 지연은 그만큼 늘어날 것이다.

**가설 2. Backpressure 부재**

Consumer가 느려지면 어떻게 되나? Producer는 계속 메시지를 밀어넣고, 큐 길이가 끝없이 늘어나고, 결국 메모리가 터질 것이다. "Consumer가 느리니까 Producer도 좀 천천히 보내라"는 신호(Backpressure)가 없으면 장애가 확대된다.

**가설 3. Consumer 수 증가의 한계**

Consumer 스레드를 10개로 늘려도 파티션이 1개면 9개는 놀게 된다. Kafka에서 "파티션 수 ≥ Consumer 수"여야 한다는 제약의 이유를 직접 확인하고 싶었다.

### 구현하며 확인한 것

**확인 1. CPU가 진짜 녹았다**

`while(true)` + `poll()` 구조로 10초간 돌렸더니 CPU 사용률이 100%를 찍었다(단일 코어 기준). `Thread.sleep(1)`을 넣으니 30%로 떨어졌지만, 여전히 높았다.

| 구성 | CPU 사용률 | 평균 처리 지연 |
|------|-----------|--------------|
| `while(true)` + `poll()` | 98.7% | 0.08ms |
| `while(true)` + `sleep(1)` | 31.2% | 1.3ms |
| `while(true)` + `sleep(10)` | 4.8% | 11.6ms |
| `BlockingQueue.take()` | 0.12% | 0.18ms |

**확인 2. BlockingQueue가 답이었다**

`LinkedBlockingQueue`의 `poll(timeout)` 또는 `take()`를 쓰면 큐가 비어 있을 때 스레드가 블로킹되어 CPU를 거의 쓰지 않는다. 메시지가 들어오면 즉시 깨어나므로 지연도 최소화된다.

```kotlin
// 개선된 구현
class Partition(val id: Int) {
    private val queue = LinkedBlockingQueue<Message>()

    fun publish(message: Message) {
        queue.put(message)
    }

    fun poll(timeout: Long): Message? {
        return queue.poll(timeout, TimeUnit.MILLISECONDS)
    }
}
```

**확인 3. Backpressure의 필요성**

Backpressure 없이 운영했을 때 시나리오를 시뮬레이션했다. Producer가 초당 1000개를 보내고, Consumer가 초당 500개를 처리하면, 1분 후 큐에 30,000개가 쌓인다. 10분이면 300,000개. `LinkedBlockingQueue`의 기본 용량은 `Integer.MAX_VALUE`이므로 메모리가 허용하는 한 계속 쌓인다.

용량 제한을 걸면 Backpressure가 자연스럽게 생긴다.

```kotlin
private val queue = LinkedBlockingQueue<Message>(10000)  // 최대 10000개

fun publish(message: Message) {
    if (!queue.offer(message, 100, TimeUnit.MILLISECONDS)) {
        throw QueueFullException("Queue is full, cannot accept more messages")
    }
}
```

Producer가 `QueueFullException`을 받으면 잠시 대기하거나 DLQ로 보내는 식으로 대응할 수 있다.

**확인 4. Consumer 수와 파티션 수의 관계**

파티션이 4개인 Topic에 Consumer를 8개 붙여봤다. 결과적으로 4개의 Consumer만 파티션을 할당받고, 나머지 4개는 아무 일도 하지 않았다. Consumer를 늘린다고 처리량이 늘어나는 게 아니었다.

### 의사결정 과정

**대안 1. Busy-wait + sleep**
장점: 구현이 단순하다.
단점: CPU 낭비, sleep 시간 튜닝이 어렵다.

**대안 2. BlockingQueue**
장점: CPU 효율적, 지연 최소화.
단점: 블로킹 구조라 스레드가 묶일 수 있다.

**대안 3. Non-blocking (Reactor/Coroutine)**
장점: 적은 스레드로 높은 동시성.
단점: 코드 복잡도 증가, 디버깅 어려움.

**최종 선택. BlockingQueue**
Mini Kafka의 목적이 Kafka 내부 구조를 이해하는 것이므로, 복잡한 Reactor 패턴보다 직관적인 BlockingQueue를 선택했다. 실제 Kafka도 내부적으로 비슷한 블로킹 구조를 사용한다.

### 트래픽 이슈 대응 포인트

Consumer 관련 장애가 발생했을 때 아래 순서로 점검한다.

1. **큐 길이가 계속 늘어나고 있나?** 큐 모니터링 지표를 확인한다. 늘어나고 있으면 Consumer가 따라가지 못하는 것이다.
2. **Consumer CPU/메모리는 정상인가?** 처리 로직에 병목이 있는지 확인한다.
3. **파티션 수와 Consumer 수는 적절한가?** Consumer를 늘려도 파티션 수보다 많으면 의미가 없다.
4. **Backpressure가 동작하고 있나?** Producer에서 `QueueFullException`이 발생하는지 확인한다.

### 느낀 점

Consumer 설계에서 가장 중요한 건 "언제 기다릴지"를 명확하게 정하는 것이다. Busy-wait는 CPU를 낭비하고, 너무 오래 sleep하면 지연이 생긴다. BlockingQueue처럼 "메시지가 올 때까지 효율적으로 기다리는" 구조가 답이었다.

Backpressure를 넣어두면 트래픽 급증 시에도 "어디에서 병목이 걸렸는지" 바로 짚을 수 있다. 큐가 가득 찼다는 건 Consumer가 느리다는 신호이고, 이 신호를 Producer에게 전달해서 전체 시스템이 graceful하게 느려지게 만들 수 있다.

### 실습으로 확인한 것

블로그에 CPU 사용률 표를 정리해 놨지만, "2.3억이라는 숫자가 실제로 찍히는 걸 봤느냐"는 다른 문제다. 직접 돌려봤다. 3초 동안 메시지를 기다리는 동안 `while(true) + poll()` 구조의 spin count가 **235,416,670번**이었다. 2.3억 번 "메시지 있어?"를 물어본 것이다. `BlockingQueue.poll(timeout)`으로 바꾸니 0번. 같은 3초를 기다렸는데 결과가 이렇게 다르다.

여기서 한 발 더 들어가 봤다. `BlockingQueue`가 CPU를 안 먹는 이유가 뭘까? 내부적으로 `LockSupport.park()`를 호출해서 스레드를 "주차"시킨다. 주차된 스레드는 엔진이 꺼진 차처럼 CPU를 아예 안 쓴다. 메시지가 도착하면 OS가 `unpark()`로 깨워준다.

이 구조를 이해하고 나니 다른 것들이 연결됐다. spinlock과 synchronized의 차이도 결국 같은 질문이었다. "기다릴 때 깨어있을 거냐, 잠들 거냐?" busy-wait는 깨어있으면서 계속 확인하고, park는 잠들었다가 깨어난다. 심지어 자바의 `synchronized` 키워드 자체도 처음에는 잠깐 spin을 해보고, 금방 안 풀리면 그때 park하는 adaptive spinning 전략을 쓴다. 전부 같은 뿌리였다.

**왜 BlockingQueue로 구현했는가.** 실제 Kafka Consumer API도 `poll(Duration)` 방식이다. 겉보기에는 busy-wait처럼 생겼지만 내부는 long polling이다. 브로커한테 fetch 요청을 보내고, 메시지가 올 때까지 브로커가 응답을 홀드한다. 미니 Kafka는 네트워크 없이 같은 JVM 안에서 동작하므로, 이 "기다림"을 `BlockingQueue.poll(timeout)`으로 시뮬레이션한 것이다. 기다리는 위치만 다르고(브로커 vs JVM 내부) 핵심은 같다. 메시지 없으면 기다리고, 오면 바로 응답한다.

### 코드

```kotlin
class Consumer<T>(
    val id: String,
    private val handler: (T) -> Unit
) {
    @Volatile private var running = true
    private var assignedPartitions: List<Partition<T>> = emptyList()

    fun start() {
        thread(name = "consumer-$id") {
            while (running) {
                assignedPartitions.forEach { partition ->
                    partition.poll(timeout = DEFAULT_POLL_TIMEOUT_MS)?.let { message ->
                        runCatching { handler(message) }
                            .onFailure { e -> println("Error processing message: ${e.message}") }
                    }
                }
            }
        }
    }

    fun assignPartitions(partitions: List<Partition<T>>) {
        assignedPartitions = partitions
    }

    fun getAssignedPartitions(): List<Partition<T>> = assignedPartitions

    fun stop() {
        running = false
    }

    companion object {
        private const val DEFAULT_POLL_TIMEOUT_MS = 100L
    }
}

class Partition<T>(val id: Int, capacity: Int = DEFAULT_CAPACITY) {
    private val queue = LinkedBlockingQueue<T>(capacity)

    fun publish(message: T): Boolean =
        queue.offer(message, DEFAULT_OFFER_TIMEOUT_MS, TimeUnit.MILLISECONDS)

    fun poll(timeout: Long): T? =
        queue.poll(timeout, TimeUnit.MILLISECONDS)

    fun size(): Int = queue.size

    companion object {
        private const val DEFAULT_CAPACITY = 10_000
        private const val DEFAULT_OFFER_TIMEOUT_MS = 100L
    }
}
```

---

## 4. Partition

### 왜 이걸 고민했나

단일 큐에 모든 이벤트가 몰리면 Consumer 한 대가 모든 부담을 떠안는다. 트래픽이 늘어나면 Consumer를 늘리면 되지 않나? 하지만 위에서 봤듯이 파티션이 1개면 Consumer를 10개 띄워도 1개만 일한다.

파티션을 어떻게 나눠야 병렬 처리의 이점을 살릴 수 있는지 확인하고 싶었다. 그리고 "같은 사용자의 이벤트는 순서가 보장되어야 한다"는 요구사항을 어떻게 만족시킬 수 있는지도 알고 싶었다.

### 어떤 문제를 예상했나

**가설 1. 핫 파티션 문제**

특정 사용자(예: 대형 셀러)에게 이벤트가 몰리면 해당 파티션만 지연이 심해질 것이다. 파티션을 4개로 나눠도 한 파티션에 트래픽의 90%가 몰리면 의미가 없다.

이 가설은 부하 테스트에서 확인했다. 특정 셀러의 주문을 의도적으로 한 파티션에 몰아보니, 그 파티션의 Consumer만 과열되어 지연이 폭증했다.

**가설 2. Round-robin과 순서 보장의 충돌**

key 없이 round-robin으로 파티션을 선택하면 같은 주문의 이벤트(생성 → 결제 → 배송)가 서로 다른 파티션에 들어갈 수 있다. Consumer 3대가 각각 다른 파티션을 처리하면 "배송" 이벤트가 "생성" 이벤트보다 먼저 처리될 수 있다.

**가설 3. AtomicInteger overflow**

Round-robin 카운터를 `AtomicInteger`로 구현하면 `Integer.MAX_VALUE`를 넘어갈 때 음수가 된다. 음수를 배열 인덱스로 쓰면 `ArrayIndexOutOfBoundsException`이 발생할 것이다.

### 구현하며 확인한 것

**확인 1. 핫 파티션 문제가 실험에서 드러났다**

테스트로 특정 key에 트래픽의 80%를 몰아봤다. 4개 파티션 중 1개의 큐 길이만 폭발적으로 늘어났고, 해당 파티션의 처리 지연이 다른 파티션의 10배가 됐다.

| 파티션 | 트래픽 비율 | 큐 길이 | 평균 지연 |
|-------|-----------|--------|---------|
| 0 | 78.3% | 47,832 | 487ms |
| 1 | 8.1% | 3,241 | 52ms |
| 2 | 7.2% | 2,876 | 48ms |
| 3 | 6.4% | 2,512 | 43ms |

**확인 2. 이중 전략이 필요했다**

key가 있으면 hash로 파티션을 선택하고(순서 보장), key가 없으면 round-robin으로 선택하는(부하 분산) 이중 전략을 적용했다.

```kotlin
fun selectPartition(key: String?): Partition =
    if (key != null) {
        val index = abs(key.hashCode()) % partitions.size
        partitions[index]
    } else {
        val index = floorMod(roundRobinCounter.getAndIncrement(), partitions.size)
        partitions[index]
    }
```

이 전략을 적용하니 순서가 중요한 메시지는 순서가 보장되고, 순서가 중요하지 않은 메시지는 고르게 분산됐다.

**확인 3. overflow 문제가 실험에서 발생했다**

`AtomicInteger`가 `Integer.MAX_VALUE`를 넘어가는 테스트를 돌렸다. 약 21억 번의 호출 후 카운터가 음수가 되면서 `ArrayIndexOutOfBoundsException`이 발생했다.

```kotlin
// 문제 있는 코드
val index = roundRobinCounter.getAndIncrement() % partitions.size
// roundRobinCounter가 음수가 되면 index도 음수

// 해결
val index = floorMod(roundRobinCounter.getAndIncrement(), partitions.size)
// floorMod는 항상 양수 반환
```

`Math.floorMod()`는 음수에 대해서도 항상 양수를 반환한다. `-1 % 4 = -1`이지만 `floorMod(-1, 4) = 3`이다.

### 의사결정 과정

**파티션 수 결정 기준**

파티션 수를 어떻게 정할까? 여러 요소를 고려했다.

1. **예상 Consumer 수**. 파티션 수 ≥ Consumer 수여야 모든 Consumer가 일할 수 있다.
2. **예상 처리량**. 파티션당 처리량 × 파티션 수 ≥ 예상 트래픽이어야 한다.
3. **순서 보장 범위**. 파티션 수가 많을수록 같은 key가 같은 파티션에 갈 확률이 줄어... 아니, hash 기반이니까 같은 key는 항상 같은 파티션에 간다.

**최종 결정**. 예상 최대 Consumer 수의 2배 정도로 파티션 수를 설정하기로 했다. Consumer를 4대까지 늘릴 수 있다면 파티션은 8개. 이렇게 하면 Consumer를 늘릴 여유가 생긴다.

### 트래픽 이슈 대응 포인트

파티션 관련 장애가 발생했을 때 아래 순서로 점검한다.

1. **파티션별 큐 길이가 균등한가?** 특정 파티션만 길이가 길다면 핫 파티션 문제다.
2. **핫 파티션의 원인이 되는 key는 무엇인가?** 해당 key의 트래픽을 분석한다.
3. **파티션 수와 Consumer 수가 적절한가?** 파티션 수 < Consumer 수면 일부 Consumer가 놀고 있다.
4. **round-robin 카운터가 정상인가?** overflow로 인한 에러가 없는지 확인한다.

### 느낀 점

파티션 설계는 단순히 "N개로 나눈다"가 아니라, key 전략과 모니터링까지 포함해야 한다는 걸 깨달았다. 파티션을 나눠놔도 트래픽 분포를 모니터링하지 않으면 핫 파티션 문제를 발견할 수 없다.

파티션별 처리량/큐 길이를 상시 모니터링해야 "왜 lag가 쌓이지?"에 답할 수 있다. 전체 처리량이 정상이어도 특정 파티션만 밀릴 수 있고, 이건 평균값만 봐서는 알 수 없다.

### 실습으로 확인한 것

이중 전략(key 있으면 hash, 없으면 round-robin)을 구현하고 실제로 돌려봤다. vip-user 한 명에게 트래픽의 80%를 몰아넣으니 파티션 4개 중 P3 하나에 825개가 쌓이고, 나머지 3개는 24~26개뿐이었다. `hashCode() % 4`니까 당연한 결과다. key 없이 round-robin으로 같은 메시지를 보내니 225개씩 정확히 균등했다.

여기까지는 Kafka가 내부적으로 하는 일을 확인한 것이다. 그런데 실습하면서 더 중요하다고 느낀 건 **"그래서 사용하는 입장에서 어떻게 대응할 것인가"**였다. Kafka는 그냥 hash로 나눌 뿐이고, 핫 파티션은 Kafka의 한계가 아니라 key 설계의 문제다.

key가 있는데 트래픽이 몰리는 경우, 현실적인 대응 전략은 세 가지 정도였다.

1. **key 세분화.** `user-123` 대신 `user-123-{timestamp}`를 key로 쓰면 같은 유저여도 파티션이 분산된다. 대신 같은 유저의 메시지 순서 보장은 포기해야 한다.
2. **핫 key 감지 + 별도 토픽.** 파티션별 lag를 모니터링하다가 특정 key의 트래픽이 급증하면 별도 토픽으로 분리 처리한다.
3. **파티션 수 증가.** 4개에서 16개로 늘리면 같은 hash라도 분포가 넓어진다. 다만 파티션 수를 바꾸면 기존 key의 파티션 매핑이 전부 바뀌므로 주의가 필요하다.

결국 순서 보장 vs 부하 분산의 트레이드오프이고, "어떤 메시지가 순서를 꼭 지켜야 하는가"라는 비즈니스 질문에 먼저 답해야 한다.

### 코드

```kotlin
class Topic<T>(val name: String, partitionCount: Int) {
    private val partitions: List<Partition<T>> = List(partitionCount) { Partition(it) }
    private val roundRobinCounter = AtomicInteger(0)

    fun selectPartition(key: String?): Partition<T> =
        key?.let { partitions[abs(it.hashCode()) % partitions.size] }
            ?: partitions[floorMod(roundRobinCounter.getAndIncrement(), partitions.size)]

    fun getPartitions(): List<Partition<T>> = partitions

    fun getPartitionStats(): Map<Int, PartitionStats> =
        partitions.associate { it.id to PartitionStats(it.id, it.size()) }
}

data class PartitionStats(
    val partitionId: Int,
    val queueLength: Int
)
```

---

## 5. Replication

### 왜 이걸 고민했나

파티션이 올라간 노드가 죽으면 어떻게 되나? 해당 파티션의 메시지가 모두 사라진다. 메모리에만 있던 데이터이기 때문이다.

실험 환경에서 `acks=1`(리더만 확인)으로 두고 리더 노드를 강제로 종료시키니, 팔로워에 복제되기 전에 메시지가 유실되는 모습을 똑같이 볼 수 있었다.

### 어떤 문제를 예상했나

**가설 1. 팔로워 지연과 중복 소비**

팔로워가 리더보다 2초 뒤쳐져 있다고 하자. Consumer가 리더에서 offset 100까지 읽고 commit했는데, 그 순간 리더가 죽어서 팔로워가 승격됐다. 새 리더에는 offset 98까지밖에 없다면? Consumer는 99, 100을 다시 읽게 된다(중복 소비).

**가설 2. ISR 없이 운영하면 성능 저하**

In-Sync Replica(ISR)는 리더와 동기화된 팔로워 목록이다. 지연된 팔로워까지 acks를 기다리면 전체 처리량이 떨어진다. ISR에서 지연된 팔로워를 제외해야 acks 대기 시간이 줄어들 것이다.

**가설 3. 리더 선출 없이는 복구 불가**

리더가 죽었을 때 팔로워 중 하나를 자동으로 리더로 승격시키는 로직이 없으면 해당 파티션은 사용 불가 상태가 된다.

### 구현하며 확인한 것

**확인 1. `acks=1`로 유실을 재현했다**

테스트 시나리오:
1. 리더에 메시지 전송 (acks=1, 리더만 확인)
2. 리더가 팔로워에 복제하기 전에 리더 프로세스 kill
3. 팔로워를 새 리더로 승격
4. 메시지 확인 → 없음!

```kotlin
// acks=1 시뮬레이션
fun publishWithAcksOne(message: Message) {
    leader.publish(message)
    // 팔로워 복제를 기다리지 않음
}
```

**확인 2. `acks=all`로 유실 방지**

모든 ISR 팔로워가 복제를 확인한 후에야 send()가 반환되도록 변경했다.

```kotlin
// acks=all 시뮬레이션
fun publishWithAcksAll(message: Message) {
    leader.publish(message)
    for (follower in inSyncReplicas) {
        follower.replicate(message)
    }
    // 모든 ISR이 복제를 확인해야 반환
}
```

같은 시나리오로 테스트했을 때 메시지가 유실되지 않았다. 리더가 죽어도 팔로워에 메시지가 있으므로 복구 가능.

**확인 3. ISR 관리가 성능의 핵심이었다**

느린 팔로워가 ISR에 있으면 모든 메시지가 그 팔로워를 기다려야 한다. 팔로워 지연이 2초면 모든 메시지의 처리 시간이 2초 이상 걸린다.

ISR에서 일정 시간(예: 10초) 이상 지연된 팔로워를 제외하는 로직을 추가했다.

```kotlin
class ReplicatedPartition {
    private val maxLagMs = 10_000L  // 10초

    fun updateISR() {
        inSyncReplicas = followers.filter { follower ->
            val lag = leader.getLatestOffset() - follower.getLatestOffset()
            val lagMs = lag * averageMessageIntervalMs
            lagMs < maxLagMs
        }
    }
}
```

### 의사결정 과정

**acks 설정 선택**

| acks 값 | 장점 | 단점 |
|---------|------|------|
| 0 | 가장 빠름 | 유실 가능성 높음 |
| 1 | 빠름 | 리더 장애 시 유실 가능 |
| all | 유실 없음 | 가장 느림 |

**최종 선택**. 중요한 비즈니스 메시지(결제, 주문)는 `acks=all`, 덜 중요한 메시지(로그, 통계)는 `acks=1`로 설정하기로 했다.

### 트래픽 이슈 대응 포인트

Replication 관련 장애가 발생했을 때 아래 순서로 점검한다.

1. **리더 파티션이 살아있나?** 리더가 죽었으면 팔로워 승격이 필요하다.
2. **ISR 목록에 팔로워가 있나?** ISR이 비어있으면 `acks=all` 메시지가 영원히 대기한다.
3. **팔로워 지연이 얼마인가?** 지연이 크면 ISR에서 제외하거나 팔로워를 증설해야 한다.
4. **acks 설정이 적절한가?** 유실이 발생했다면 `acks=all`로 변경을 검토한다.

### 느낀 점

Replication은 단순히 복제본을 늘리는 문제가 아니라, 지연을 감시하고 승격 절차를 자동화해야 한다는 점을 상기시킨다. 복제본이 3개 있어도 모두 지연되면 의미가 없다.

"acks=all"은 ISR에 있는 모든 팔로워가 복제를 확인할 때까지 기다리는 옵션이다. 개념만 보면 단순해 보이지만, 직접 구현해 보면 지연이 있는 팔로워 하나 때문에 전체 처리량이 영향을 받는 구조를 명확히 체감하게 된다.

### 실습으로 확인한 것

위에서 acks 모드별 차이를 다뤘지만, "어떻게 복제하는가" 자체는 다루지 않았다.
실습하면서 이 부분이 빈 채로 남아있다는 게 계속 걸렸다.
그래서 직접 Pull 방식 복제를 구현해 봤다.

Kafka의 복제는 **Pull 방식**이다.
리더가 팔로워에 push하는 게 아니라,
팔로워가 "나 offset 5까지 있어, 그 이후 줘"하고 fetch 요청을 보낸다.
리더 입장에서는 요청이 올 때 응답만 하면 된다.

```
[리더] offset=0 저장: 주문-001
[F1] fetch(offset>-1) → 1개 복제 완료, latest=0
[F2] fetch(offset>-1) → 1개 복제 완료, latest=0

[리더] offset=1 저장: 주문-002
[F1] fetch(offset>0) → 1개 복제 완료, latest=1
[F2] fetch(offset>0) → 1개 복제 완료, latest=1
```

그런데 팔로워가 fetch를 주기적으로 해야 한다면,
팔로워도 busy-wait 문제가 있는 거 아닌가?
1초마다 fetch하면 1초 지연이 생기고,
100ms마다 하면 리더한테 부하가 간다.

Kafka는 이걸 Consumer에서 썼던 것과 같은 방식으로 해결한다.
**long polling이다.**
팔로워가 fetch 요청을 보내면 리더가 메시지 없을 때 바로 응답하지 않고,
메시지가 도착할 때까지 홀드한다.
`replica.fetch.wait.max.ms`(기본 500ms) 동안 기다려도 안 오면 빈 응답을 보낸다.

결국 Consumer의 `poll(Duration)`,
팔로워의 fetch 요청,
미니 Kafka의 `BlockingQueue.poll(timeout)`이 전부 같은 메커니즘이었다.
"메시지 없으면 기다리고, 오면 바로 응답."

| | Push (리더→팔로워) | Pull (팔로워→리더) |
|---|---|---|
| 주도권 | 리더 | 팔로워 |
| 리더 부하 | 높음 (모든 팔로워에 전송) | 낮음 (요청 올 때만 응답) |
| 팔로워 | 수동적 (받기만) | 능동적 (자기 속도로 fetch) |
| Kafka | X | O |

Kafka가 Pull을 선택한 이유를 정리하면 이렇다.
팔로워마다 속도가 다르니까 각자 자기 pace로 fetch할 수 있고,
리더가 팔로워 상태를 일일이 관리할 필요가 없고,
팔로워를 추가하거나 제거해도 리더 코드를 안 건드린다.

### 코드

```kotlin
class ReplicatedPartition<T>(
    val id: Int,
    replicaCount: Int
) {
    private var leader: Partition<T> = Partition(id)
    private val followers: MutableList<Partition<T>> = MutableList(replicaCount - 1) { Partition(id) }
    private var inSyncReplicas: MutableList<Partition<T>> = followers.toMutableList()

    fun publish(message: T, acks: AcksMode = AcksMode.ALL) {
        leader.publish(message)

        when (acks) {
            AcksMode.NONE -> Unit
            AcksMode.LEADER_ONLY -> Unit
            AcksMode.ALL -> inSyncReplicas.forEach { it.publish(message) }
        }
    }

    fun electNewLeader(): Boolean {
        val newLeader = inSyncReplicas.firstOrNull() ?: return false
        inSyncReplicas.removeAt(0)
        followers.remove(newLeader)
        leader = newLeader
        return true
    }

    fun updateISR() {
        inSyncReplicas = followers
            .filter { follower -> leader.size() - follower.size() < MAX_LAG_THRESHOLD }
            .toMutableList()
    }

    companion object {
        private const val MAX_LAG_THRESHOLD = 100
    }
}

sealed class AcksMode {
    data object NONE : AcksMode()        // acks=0
    data object LEADER_ONLY : AcksMode() // acks=1
    data object ALL : AcksMode()         // acks=all
}
```

---

## 6. Consumer Group

### 왜 이걸 고민했나

Consumer를 여러 대 띄우면 어떻게 되나? 아무 조율 없이 띄우면 두 가지 문제가 생긴다.

1. **중복 처리**. 같은 메시지를 여러 Consumer가 처리한다.
2. **처리 누락**. 어떤 메시지는 아무도 처리하지 않는다.

Consumer Group은 "같은 그룹의 Consumer들은 메시지를 나눠서 처리한다"는 규칙을 제공한다. 그룹 내 Consumer A가 파티션 0을 담당하면, Consumer B는 파티션 0을 건드리지 않는다.

문제는 Consumer가 늘어나거나 줄어들 때다. 오토스케일링 환경에서 Consumer가 1분마다 추가되고 제거되면 파티션 재할당(리밸런싱)이 계속 발생한다. 리밸런싱 중에는 메시지 처리가 멈추므로 lag가 쌓인다.

과거에 오토스케일이 너무 민감하게 반응해서 리밸런싱 폭풍(rebalance storm)이 발생한 적이 있다. CPU가 70%만 넘어도 인스턴스를 추가하고, 50% 아래로 떨어지면 제거하는 설정이었는데, 트래픽 패턴에 따라 1분에 여러 번 스케일 인/아웃이 발생했다.

### 어떤 문제를 예상했나

**가설 1. 리밸런스 중 lag 폭발**

리밸런싱이 1분 간격으로 계속 발생하면, 매번 10초씩 처리가 멈추고, 그 사이 메시지가 1000개씩 쌓인다면 lag가 줄어들 틈이 없다.

**가설 2. 파티션 할당 불균형**

Consumer 수가 파티션 수로 나눠떨어지지 않으면 일부 Consumer가 더 많은 파티션을 담당한다. 예를 들어 파티션 4개에 Consumer 3대면, 한 Consumer가 파티션 2개를 담당해야 한다.

**가설 3. chunk 계산 버그**

파티션을 Consumer에 나눠주는 로직에서 `floor`와 `ceil`을 잘못 쓰면 마지막 Consumer가 파티션을 못 받는 버그가 생길 수 있다.

### 구현하며 확인한 것

**확인 1. 리밸런스 폭풍 재현**

1분 간격으로 Consumer를 추가/제거하는 테스트를 돌렸다.

```
[10:00] Consumer 추가 → 리밸런싱 시작, 15초간 처리 중단
[10:01] Consumer 제거 → 리밸런싱 시작, 15초간 처리 중단
[10:02] Consumer 추가 → 리밸런싱 시작, 15초간 처리 중단
...
```

1분 중 15초가 처리 중단이면 처리량이 75%로 떨어진다. lag는 계속 쌓여서 1만 건을 넘어갔다.

**확인 2. cooldown으로 해결**

스케일 인/아웃 후 최소 5분간은 추가 스케일링을 막는 cooldown 로직을 추가했다.

```kotlin
class ConsumerGroup {
    private var lastRebalanceTime = 0L
    private val cooldownMs = 5 * 60 * 1000L  // 5분

    fun canRebalance(): Boolean {
        return System.currentTimeMillis() - lastRebalanceTime > cooldownMs
    }

    fun register(consumer: Consumer) {
        if (!canRebalance()) {
            pendingConsumers.add(consumer)
            return
        }
        consumers.add(consumer)
        rebalance()
        lastRebalanceTime = System.currentTimeMillis()
    }
}
```

cooldown을 적용하니 리밸런싱 빈도가 줄어들고 lag가 안정화됐다.

**확인 3. chunk 계산 버그**

처음에 이렇게 구현했다.

```kotlin
val chunkSize = partitions.size / consumers.size  // floor
val chunks = partitions.chunked(chunkSize)
```

파티션 5개, Consumer 3대일 때:
- `chunkSize = 5 / 3 = 1`
- `chunks = [[p0], [p1], [p2], [p3], [p4]]` → 5개의 chunk

Consumer는 3대인데 chunk가 5개면 어떻게 되나? 뒤의 2개 chunk(p3, p4)가 할당되지 않는다.

`ceil`로 수정했다.

```kotlin
val chunkSize = ceil(partitions.size / consumers.size.toDouble()).toInt()
val chunks = partitions.chunked(chunkSize)
```

파티션 5개, Consumer 3대일 때:
- `chunkSize = ceil(5 / 3.0) = 2`
- `chunks = [[p0, p1], [p2, p3], [p4]]` → 3개의 chunk

이제 모든 파티션이 할당된다.

### 의사결정 과정

**리밸런싱 전략**

1. **Eager 리밸런싱**. 모든 Consumer가 파티션을 반납하고 다시 할당. 구현이 단순하지만 모든 Consumer가 잠시 멈춤.
2. **Incremental 리밸런싱**. 변경이 필요한 Consumer만 파티션을 조정. 구현이 복잡하지만 중단 최소화.

**최종 선택**. Mini Kafka에서는 Eager 방식을 선택했다. 실제 Kafka도 오랫동안 Eager 방식을 사용했고, Incremental(Cooperative)은 최근에야 도입됐다.

### 트래픽 이슈 대응 포인트

Consumer Group 관련 장애가 발생했을 때 아래 순서로 점검한다.

1. **리밸런싱이 자주 발생하고 있나?** 리밸런싱 로그를 확인한다.
2. **오토스케일 정책이 너무 민감한가?** cooldown 시간을 확인하고 조정한다.
3. **모든 파티션이 할당됐나?** 파티션-Consumer 매핑을 확인한다.
4. **특정 Consumer에 파티션이 몰려있나?** 할당 균형을 확인한다.

### 느낀 점

Consumer Group은 "얼마나 기다렸다가 재분배할지"를 정하는 게 핵심이다. 너무 빨리 재분배하면 리밸런스 폭풍, 너무 느리면 일부 파티션이 처리되지 않는다.

모니터링 없이 오토스케일만 믿으면 장애가 더 커질 수 있다는 사실을 코드로 증명할 수 있게 됐다. "CPU가 높으니까 자동으로 늘어나겠지"라는 생각이 오히려 리밸런스 폭풍을 유발한다.

### 실습으로 확인한 것

cooldown 없이 Consumer를 추가/제거하는 테스트를 직접 돌려봤다.
변경 6번에 리밸런스 6번이 발생했다.
매번 모든 Consumer가 파티션을 반납하고 다시 할당받는다.

```
+C0: [C0 → [P0, P1, P2, P3, P4, P5]]
+C1: [C0 → [P0, P1, P2], C1 → [P3, P4, P5]]
+C2: [C0 → [P0, P1], C1 → [P2, P3], C2 → [P4, P5]]
-C1: [C0 → [P0, P1, P2], C2 → [P3, P4, P5]]
+C3: ...
총 리밸런스: 6회
```

cooldown 500ms를 걸었더니 첫 번째 Consumer만 즉시 리밸런스되고,
나머지 변경은 대기열에 모였다가 cooldown 끝나면 한꺼번에 처리됐다.
4번 변경에 리밸런스 2번만 발생했다.
실제 운영에서는 이 cooldown이 5분이다.

chunk 계산 버그도 직접 눈으로 봤다.
파티션 5개, Consumer 3대일 때 `5/3=1`로 chunked하면
P3, P4가 미할당되는 게 출력에 그대로 찍혔다.
`ceil(5/3)=2`로 바꾸면 chunk 3개로 정확히 맞았다.

`floorMod` 이야기도 여기서 나왔다.
round-robin 카운터가 `AtomicInteger`인데,
21억번 메시지 이후에 overflow가 나면 음수가 된다.
`-1 % 4 = -1`이라 배열 인덱스가 터진다.
`Math.floorMod(-1, 4) = 3`으로 항상 양수를 보장한다.
이건 테스트에선 절대 안 잡히고 운영에서 며칠 돌리다 터지는 류의 버그다.
리셋 로직을 넣으려면 또 synchronized가 필요하니까,
수학 함수 한 줄로 해결하는 쪽이 가성비가 훨씬 낫다.

### 코드

```kotlin
class ConsumerGroup<T>(
    private val groupId: String,
    private val topic: Topic<T>
) {
    private val consumers: MutableList<Consumer<T>> = mutableListOf()
    private val pendingConsumers: MutableList<Consumer<T>> = mutableListOf()
    private var lastRebalanceTime: Long = 0L

    fun register(consumer: Consumer<T>) {
        if (!canRebalance()) {
            pendingConsumers.add(consumer)
            schedulePendingRebalance()
            return
        }
        consumers.add(consumer)
        rebalance()
    }

    fun unregister(consumer: Consumer<T>) {
        consumers.remove(consumer)
        if (canRebalance()) {
            rebalance()
        }
    }

    private fun canRebalance(): Boolean =
        System.currentTimeMillis() - lastRebalanceTime > COOLDOWN_MS

    private fun schedulePendingRebalance() {
        thread {
            Thread.sleep(COOLDOWN_MS)
            consumers.addAll(pendingConsumers)
            pendingConsumers.clear()
            rebalance()
        }
    }

    private fun rebalance() {
        if (consumers.isEmpty()) return

        val partitions = topic.getPartitions()
        val chunkSize = ceil(partitions.size / consumers.size.toDouble()).toInt()
        val chunks = partitions.chunked(chunkSize)

        consumers.forEachIndexed { index, consumer ->
            consumer.assignPartitions(chunks.getOrElse(index) { emptyList() })
        }

        lastRebalanceTime = System.currentTimeMillis()
    }

    fun getAssignments(): Map<String, List<Int>> =
        consumers.associate { consumer ->
            consumer.id to consumer.getAssignedPartitions().map { partition -> partition.id }
        }

    companion object {
        private const val COOLDOWN_MS = 5 * 60 * 1000L
    }
}
```

---

## 7. Offset

### 왜 이걸 고민했나

Consumer가 재시작하면 어디서부터 읽어야 하나? offset(현재 읽은 위치)을 저장하지 않으면 두 가지 문제가 생긴다.

1. **중복 처리**. 처음부터 다시 읽으면 이미 처리한 메시지를 또 처리한다.
2. **유실**. 마지막까지 건너뛰면 처리 안 된 메시지가 사라진다.

manual commit 위치를 잘못 잡으면 중복 결제가 발생할 수 있다. 예를 들어 결제 API를 호출하기 전에 offset을 commit했는데, 결제 API가 타임아웃으로 실패하면 같은 결제 요청이 두 번 나간다.

### 어떤 문제를 예상했나

**가설 1. 핸들러 초반 commit의 위험**

메시지 핸들러 시작 시점에 offset을 commit하면, 핸들러가 실패해도 offset은 이미 넘어간 상태다. 재시도할 때 해당 메시지는 건너뛰어진다.

```kotlin
fun handle(message: Message) {
    offsetManager.commit(offset)  // 먼저 commit
    processPayment(message)        // 여기서 실패하면?
    // → offset은 이미 commit됐으므로 재시도 시 이 메시지를 건너뜀
}
```

**가설 2. 인메모리 offset의 휘발성**

offset을 인메모리에만 저장하면 Consumer가 재시작될 때 모든 offset이 사라진다. 어디까지 처리했는지 알 수 없으니 처음부터 다시 읽거나, 끝까지 건너뛰거나 해야 한다.

**가설 3. auto-commit의 위험**

Kafka에는 auto-commit 기능이 있다. 일정 주기(예: 5초)마다 현재 offset을 자동으로 commit한다. 편리하지만, 메시지를 받았지만 아직 처리하지 않은 상태에서 commit되면 그 메시지는 유실된다.

### 구현하며 확인한 것

**확인 1. 핸들러 초반 commit으로 중복 처리 재현**

테스트 시나리오:
1. 메시지 받음 (offset=100)
2. offset commit (100 → 101)
3. 결제 API 호출 → 타임아웃 예외 발생
4. Consumer 재시작
5. offset=101부터 읽음 → offset=100 메시지는 처리 안 됨

이 시나리오에서 결제 API는 처리됐을 수도 있고 안 됐을 수도 있다. 타임아웃이 발생했다는 건 "응답을 못 받았다"는 뜻이지 "처리가 안 됐다"는 뜻이 아니다.

**확인 2. 핸들러 완료 후 commit으로 at-least-once 보장**

```kotlin
fun handle(message: Message) {
    processPayment(message)        // 먼저 처리
    offsetManager.commit(offset)  // 성공 후 commit
}
```

이 구조에서는 핸들러가 실패하면 offset이 commit되지 않으므로, 재시작 시 같은 메시지를 다시 받는다. 중복 처리가 발생할 수 있지만 유실은 없다. 이를 "at-least-once" 보장이라고 한다.

중복 처리를 막으려면 비즈니스 로직에서 idempotency를 구현해야 한다. 예를 들어 결제 요청에 고유 ID를 포함시키고, 이미 처리된 ID는 무시한다.

**확인 3. 외부 저장소의 필요성**

offset을 인메모리에만 두면 Consumer 재시작 시 모든 offset이 사라진다. Redis나 DB 같은 외부 저장소에 저장해야 지속성이 보장된다.

```kotlin
// 인메모리 (휘발성)
class InMemoryOffsetManager {
    private val offsets = ConcurrentHashMap<String, Long>()
}

// Redis (지속성)
class RedisOffsetManager(private val redis: RedisClient) {
    fun commit(groupId: String, partitionId: Int, offset: Long) {
        redis.set("offset:$groupId:$partitionId", offset.toString())
    }

    fun getOffset(groupId: String, partitionId: Int): Long {
        return redis.get("offset:$groupId:$partitionId")?.toLong() ?: 0L
    }
}
```

### 의사결정 과정

**commit 전략**

| 전략 | 장점 | 단점 |
|------|------|------|
| 핸들러 전 commit | 중복 처리 없음 | 유실 가능 |
| 핸들러 후 commit | 유실 없음 | 중복 처리 가능 |
| auto-commit | 구현 단순 | 유실/중복 모두 가능 |

**최종 선택**. 핸들러 후 commit + idempotency 구현. 유실은 절대 안 되고, 중복은 비즈니스 로직에서 막을 수 있다.

**저장소 선택**

실제 Kafka는 offset을 내부 Topic(`__consumer_offsets`)에 저장한다. Mini Kafka에서는 간단하게 인메모리로 구현하되, 실제 운영에서는 Redis나 DB를 사용해야 한다는 점을 명시했다.

### 트래픽 이슈 대응 포인트

offset 관련 장애가 발생했을 때 아래 순서로 점검한다.

1. **중복 처리가 발생했나?** 비즈니스 로그에서 같은 요청이 두 번 처리됐는지 확인한다.
2. **commit 순서가 올바른가?** 핸들러 완료 후 commit하고 있는지 코드를 확인한다.
3. **offset 저장소가 정상인가?** Redis/DB 연결 상태를 확인한다.
4. **idempotency가 구현되어 있나?** 중복 요청을 막는 로직이 있는지 확인한다.

### 느낀 점

commit 순서는 "DB 트랜잭션 커밋 → idempotent write → offset commit"으로 고정해야 한다. 이 순서를 지키지 않으면 중복이나 유실이 발생한다.

재처리 전략을 정리할 때 가장 먼저 물어야 할 항목은 "offset을 어디에 저장했는가"다. 인메모리면 휘발성, 외부 저장소면 지속성. 저장소 선택이 복구 가능 범위를 결정한다.

### 실습으로 확인한 것

commit 타이밍에 따라 유실과 중복이 어떻게 갈리는지를 직접 재현해 봤다.

commit을 먼저 하는 구조에서는 pay-2 처리 중 장애가 발생했을 때
offset이 이미 넘어간 상태라 재시작해도 pay-2를 다시 읽지 않았다. 유실이다.

처리를 먼저 하는 구조에서는 pay-2 실패 시 offset이 commit되지 않았다.
재시작하니 pay-1부터 다시 읽었는데,
pay-1은 이미 처리했으므로 멱등성 체크로 스킵하고 pay-2만 재처리했다.
중복은 발생하지만 유실은 없다.

여기까지는 Consumer 쪽 이야기다.
그런데 실습하면서 한 가지 더 궁금해진 게 있었다.
"at-least-once로 Consumer 중복을 막는다지만,
Producer 쪽에서도 중복이 생기지 않나?"

네트워크 타임아웃으로 ack를 못 받으면
Producer가 같은 메시지를 재전송한다.
이걸 Kafka 브로커가 어떻게 걸러내는지를 직접 구현해 봤다.

핵심은 `(producerId, sequenceNumber)` 조합이다.
Producer가 초기화될 때 브로커에서 고유 ID를 발급받고,
메시지마다 sequence number를 증가시켜 붙인다.
브로커는 이미 본 조합이면 저장하지 않고 ack만 반환한다.

```
[브로커] 저장: pid=0, seq=0, "결제 10000원"
[브로커] 저장: pid=0, seq=1, "결제 20000원"
[브로커] 저장: pid=0, seq=2, "결제 30000원"

--- 네트워크 장애로 재시도 ---
[Producer] 재시도: seq=1, "결제 10000원"
[브로커] 중복 감지! pid=0, seq=1 → 무시, ack 전송

--- 브로커 로그 ---
총 3개 (5번 전송했지만 중복 제거됨)
```

이게 `enable.idempotence=true`의 내부 동작이다.
Consumer 멱등성은 비즈니스 로직에서 해결해야 하지만,
Producer 멱등성은 Kafka 브로커가 직접 해준다.
실무에서는 거의 다 at-least-once + 양쪽 멱등성 조합을 쓴다.
돈이 날아가는 것보다 중복 체크가 훨씬 싸니까.

### 코드

```kotlin
class OffsetManager {
    private val offsets = ConcurrentHashMap<String, ConcurrentHashMap<Int, Long>>()

    fun commit(groupId: String, partitionId: Int, offset: Long) {
        offsets.computeIfAbsent(groupId) { ConcurrentHashMap() }[partitionId] = offset
    }

    fun getOffset(groupId: String, partitionId: Int): Long =
        offsets[groupId]?.get(partitionId) ?: DEFAULT_OFFSET

    fun getAllOffsets(groupId: String): Map<Int, Long> =
        offsets[groupId]?.toMap() ?: emptyMap()

    companion object {
        private const val DEFAULT_OFFSET = 0L
    }
}

class ConsumerWithOffset<T>(
    private val id: String,
    private val groupId: String,
    private val offsetManager: OffsetManager,
    private val handler: (T) -> Unit
) {
    fun processMessage(partition: PartitionWithOffset<T>) {
        val currentOffset = offsetManager.getOffset(groupId, partition.id)
        val message = partition.pollAt(currentOffset) ?: return

        runCatching { handler(message) }
            .onSuccess { offsetManager.commit(groupId, partition.id, currentOffset + 1) }
            .onFailure { e -> throw e }  // offset 미 commit으로 재시도 보장
    }
}

class PartitionWithOffset<T>(val id: Int) {
    private val messages: MutableList<T> = mutableListOf()

    fun pollAt(offset: Long): T? = messages.getOrNull(offset.toInt())

    fun publish(message: T) {
        messages.add(message)
    }
}
```

---

## 마무리

각 컴포넌트에서 내린 핵심 의사결정을 정리하면 다음과 같다.

| 컴포넌트 | 핵심 의사결정 | 근거 |
|---------|-------------|------|
| Topic | 도메인별 분리 | 장애 격리, SLA 분리 |
| Producer | Fire-and-forget + DLQ | 장애 지점 분리 |
| Consumer | BlockingQueue + Backpressure | CPU 효율, 장애 전파 방지 |
| Partition | key 기반 + round-robin 이중 전략 | 순서 보장 + 부하 분산 |
| Replication | acks=all + ISR 관리 | 유실 방지 + 성능 균형 |
| Consumer Group | cooldown + ceil 기반 할당 | 리밸런스 폭풍 방지 |
| Offset | 핸들러 후 commit + 외부 저장소 | at-least-once 보장 |

이제는 트래픽 이슈가 발생했을 때 다음처럼 체계적으로 점검할 수 있다.

### 장애 대응 체크리스트

**1단계. 증상 파악**
- 어떤 Topic에서 문제가 발생했나?
- lag가 쌓이고 있나? 어느 파티션에서?
- DLQ에 메시지가 쌓이고 있나?

**2단계. 원인 분류**
- Producer 문제: Kafka 연결 실패, key 설정 오류
- Consumer 문제: 처리 속도 저하, 핸들러 예외
- 파티션 문제: 핫 파티션, 할당 불균형
- 리밸런스 문제: 잦은 스케일 인/아웃
- Replication 문제: 팔로워 지연, 리더 장애

**3단계. 대응**
- 단기: 문제 파티션/Consumer 재시작, DLQ 재처리
- 중기: 파티션 수 조정, Consumer 증설, cooldown 조정
- 장기: 모니터링 강화, 알림 설정, 문서화

> 결론: 메시지 큐를 직접 구현해 보니, "왜 파티션을 나눠야 하는지", "왜 Consumer Group이 필요한지" 같은 질문에 문서 인용이 아닌 경험으로 답할 수 있게 됐다. 다음에 트래픽 이슈가 생기면 이 체크리스트부터 꺼내볼 생각이다.
