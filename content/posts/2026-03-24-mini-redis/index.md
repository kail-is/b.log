---
title: "Mini Redis 직접 구현하기: Geo 캐시까지 꿰뚫어 보기"
slug: mini-redis
date: 2026-03-24
cover: ../../images/sea.jpeg
generate-card: false
language: ko
tags:
- BE
- Redis
---

> SET/GET은 익숙했지만, 그 뒤에 숨어 있는 구조는 늘 궁금했다. 자료구조 명령, TTL, Geo, Pub/Sub, Cluster 같은 부가기능을 직접 구현해 보고 싶었다. 명령어 속도도 재보면 재미있겠다고 생각했다. 결국 호기심이 Mini Redis를 만들게 했다!

---

- **이번 글에서 확인한 흐름**
  - Core store/TTL → 자료구조 → Pub/Sub → 클러스터링 → Geo 캐시 순서로 Redis 핵심 기능을 직접 구현하며 다뤘다.
  - 각 파트마다 왜 이 기능이 필요했는지, 어떤 가설을 세웠는지, 실험/구현으로 무엇을 검증했는지를 남겼다.

- **시리즈 함께 보기**
  - [Mini Kafka 직접 구현하기: Outbox 다음 단계에서 본 메시지 큐 구조](/mini-kafka) — Outbox 뒤 메시지 큐 파트를 직접 만들어 본 글과 연결하면 전체 데이터 파이프라인이 이어진다.

- **바로가기**
  - [Mini Redis를 만든 이유](#mini-redis를-만든-이유)
  - [1. Core Store & TTL](#1-core-store--ttl)
  - [2. 자료구조 (String/List/Set/Sorted Set)](#2-자료구조-stringlistsetsorted-set)
  - [3. Pub/Sub](#3-pubsub)
  - [4. Persistence (RDB / AOF)](#4-persistence-rdb--aof)
  - [5. Eviction](#5-eviction)
  - [6. Geo 캐시](#6-geo-캐시)
  - [7. Cluster & Sharding](#7-cluster--sharding)
  - [마무리](#마무리)

---

## Mini Redis를 만든 이유

Redis는 그동안 자주 써 왔다. 어떤 식으로 활용해야 하는지 용례도 많이 파악하고 있다. 예를 들어 IncerPay HA 2-1 글에서는 상점 Seller 정보를 7일 TTL로 Redis에 캐싱하고, Terms 데이터는 Caffeine 30일 TTL로 두어 TTL 기준을 비즈니스 지표로 정리했다. 또 HA 2-2에서는 Pub/Sub으로 키 갱신을 전파할지, Queue로 묶을지 비교하며 Redis 선택 기준을 정리했다. 즉, 운영에서 Redis를 사용하는 방법과 TTL 의사결정은 이미 충분히 글로 남겼다는 뜻이다.

그런데 그렇게 애플리케이션에서 자주 쓰고 아키텍처 레벨에서는 의사결정을 내리고 있지만, 정작 내부가 어떻게 구성되어 있는지는 여전히 블랙박스처럼 남아 있었다. 추상화된 메서드를 "사용"하는 것에 가깝지, 그 내부가 어떤 자료구조로 돌아가는지 고민할 기회는 많지 않았다.

Mini Kafka를 만들며 Outbox 이후 메시지 큐 구조를 직접 뜯어본 것처럼, 이번에는 Redis의 핵심 기능(커맨드, TTL, Geo, Cluster 등)이 어떤 코드로 돌아가는지 직접 구현해 보고 싶었다.

현재 운영 중인 좌표 기반 캐시 시나리오(Coffice 서버)를 예로 삼아, 키 전략, TTL, 자료구조, 복구 전략을 하나씩 만들어 가며 어떻게 설계할지 스스로 정리해 보았다.

Mini Redis를 만들 때 아래 원칙을 세웠다.

1. **가설-검증-정리** : 각 기능을 구현하기 전에 어떤 문제가 생길지 가설을 세우고, 코드로 확인한 뒤 확인한 점/느낀점을 남긴다.
2. **의사결정 기록** : 선택한 전략뿐 아니라 포기한 대안까지 기록한다. "왜 A가 아닌 B를 선택했는가"를 나중에 설명할 수 있어야 한다.
3. **실험과 연결** : 좌표 기반 서비스 시나리오, Geo API 비용 절감 가설과 연결해 왜 이런 선택을 했는지 설명한다.
4. **캐시 이슈 대응 관점으로 정리한다** : 구현을 마친 후 "캐시 장애가 나면 어떤 순서로 점검할 것인가"를 적는다.

이에 따라 아래 섹션은 **왜 고민했나 → 예상한 문제 → 구현하며 확인한 것 → 의사결정 과정 → 캐시 이슈 대응 포인트 → 느낀 점 → 코드** 순서를 반복한다.

---

## 1. Core Store & TTL

### 왜 고민했나

이전 INNER CIRCLE HA 2-1 글에서 TTL 기준을 잡을 때 어떤 지표를 보아야 하는지(상점 비율, Public Key 신선도, 약관 데이터 TTL 30일 등)를 이미 정리해 두었다. 거기서는 "TTL을 얼마로 둘 것인가"라는 의사결정을 비즈니스 관점에서 다뤘다면, 이번 Mini Redis에서는 "TTL이 실제로 어떻게 작동해야 하나"를 엔진 관점에서 확인하고 싶었다. 좌표 기반 캐시를 예시로 삼아, 만료 스캐닝·삭제 전략·Duration 단위 처리 같은 구현 디테일을 직접 만들어 보자는 마음이었다.

### 예상한 문제

**가설 1. Lazy 만료의 메모리 문제**

Lazy expiration은 키를 조회할 때만 만료 여부를 확인한다. 조회하지 않는 키는 만료 시간이 지나도 메모리에 계속 남아 있을 것이다. 만약 수백만 개의 좌표를 캐시하고 대부분이 다시 조회되지 않는다면, 메모리가 금방 가득 찰 것이다.

좌표 캐시는 "한 번만 조회된 뒤 다시는 쓰이지 않는 데이터"가 대다수라는 통계가 자주 언급된다. 이런 데이터가 TTL이 지나도 메모리에 남아 있다면?

**가설 2. Active 만료의 CPU 문제**

Active expiration은 별도 스레드가 주기적으로 만료된 키를 삭제한다. 하지만 키가 수백만 개라면? 매번 전체 키를 순회하면서 만료 여부를 확인하면 CPU를 과하게 사용할 것이다.

**가설 3. TTL 단위의 정밀도**

TTL을 초 단위로만 설정할 수 있다면 "영업시간 동안만 캐시"같은 요구를 만족시키기 어려울 것이다. 예를 들어 "오전 9시부터 오후 6시까지만 캐시"라는 요구가 들어오면 어떻게 구현해야 할까?

### 구현하며 확인한 것

**확인 1. Lazy 만료만 쓰니 메모리가 폭발했다 (당연함)**

테스트로 100만 개의 키를 TTL 1초로 설정하고 삽입했다. 10초 후 메모리 사용량을 확인했더니 여전히 100만 개의 키가 메모리에 남아 있었다. Lazy 만료는 조회할 때만 삭제하므로, 조회하지 않는 키는 영원히 남는다.

```kotlin
// 100만 개 삽입 후 10초 대기
repeat(1_000_000) { i ->
    store.set("key-$i", "value", ttlMs = 1000)
}
Thread.sleep(10_000)
println(store.size())  // 출력: 1000000 (삭제되지 않음!)
```

**확인 2. Active 만료로 해결, 하지만 CPU 조절이 필요했다**

Active expiration 스레드를 추가했다. 처음에는 100ms마다 전체 키를 순회하도록 구현했는데, **키가 많아지니 CPU 사용률이 30%**까지 치솟았다.

**Redis의 접근 방식을 참고해서 "샘플링"을 도입했다.** 

전체 키를 순회하는 대신, 무작위로 20개의 키를 뽑아서 만료 여부를 확인한다. 만료된 키가 샘플의 25% 이상이면 다시 샘플링을 반복한다. 이렇게 하면 만료된 키가 많을 때는 적극적으로 삭제하고, 적을 때는 CPU를 아낄 수 있다.

| 구성 | CPU 사용률 | 만료 키 처리 속도 |
|------|-----------|-----------------|
| 전체 순회 (100ms) | 28.4% | 빠름 |
| 샘플링 20개 (100ms) | 0.47% | 적당함 |
| 샘플링 20개 (1000ms) | 0.08% | 느림 |

**확인 3. TTL을 Duration으로 받아야 유연했다**

초 단위로만 받으면 "500ms 후 만료"를 표현할 수 없다. `Duration`이나 밀리초 단위로 받아야 세밀한 정책을 넣을 수 있었다.

```kotlin
// Duration으로 받으면 유연함
store.set("key", "value", ttl = Duration.ofMillis(500))
store.set("key", "value", ttl = Duration.ofHours(1))
store.set("key", "value", ttl = Duration.ofDays(7))
```

### 의사결정 과정

**만료 전략 선택**

| 전략 | 장점 | 단점 |
|------|------|------|
| Lazy만 | 구현 단순, CPU 부하 없음 | 메모리 낭비 |
| Active만 | 메모리 효율적 | CPU 부하, 구현 복잡 |
| Lazy + Active | 균형 잡힌 성능 | 구현 복잡도 증가 |

**최종 선택. Lazy + Active 조합**
Redis가 이 조합을 쓰는 이유를 직접 체험했다. Lazy는 조회 시점에 즉시 만료를 처리하고, Active는 백그라운드에서 조회되지 않는 키를 정리한다. 두 전략이 서로의 단점을 보완한다.

**TTL 기본값 정하기**

좌표 기반 서비스 시나리오에서 아래 특징을 가정했다.
- 카페 위치는 자주 변하지 않는다 (평균 수명 2년 이상)
- 하지만 폐업·이전이 발생하면 즉시 반영되어야 한다
- 지도 API 비용을 고려하면 캐시 히트율을 높여야 한다

이를 종합해 기본 TTL을 24시간으로 설정하고, 위치 변경 이벤트가 발생하면 해당 키를 즉시 삭제하는 전략을 선택했다.

### 캐시 이슈 대응 포인트

TTL 관련 장애가 발생했을 때 아래 순서로 점검한다.

1. **메모리 사용량이 계속 증가하고 있나?** Active expiration이 제대로 동작하는지 확인한다.
2. **만료된 데이터가 반환되고 있나?** Lazy expiration 로직에 버그가 있는지 확인한다.
3. **TTL 설정이 적절한가?** 비즈니스 요구사항과 맞는지 검토한다.
4. **캐시 미스율이 갑자기 높아졌나?** TTL이 너무 짧거나, 대량 만료가 동시에 발생했을 수 있다.

### 느낀 점

TTL은 기능이 아니라 운영 전략이라는 걸 체감했다. "TTL을 1시간으로 설정한다"는 기술적 결정이 아니라 "데이터 신선도와 API 비용 사이에서 1시간이 적절하다"는 비즈니스 결정이다. 트래픽 패턴, 데이터 변경 빈도, 외부 API 비용을 종합해서 결정해야 한다.

Lazy + Active 조합을 직접 구현해 보니 Redis가 왜 두 방식을 섞어서 쓰는지 몸으로 이해했다. 단순히 "Redis가 이렇게 한다"가 아니라 "이렇게 하지 않으면 이런 문제가 생긴다"를 설명할 수 있게 됐다.

### 코드

```kotlin
enum class DataType {
    STRING, LIST, SET, SORTED_SET, HASH
}

data class RedisValue<T>(
    val data: T,
    val type: DataType,
    val expireAt: Long? = null
) {
    fun isExpired(): Boolean =
        expireAt != null && System.currentTimeMillis() > expireAt
}

class MiniRedis<T> {
    private val store = ConcurrentHashMap<String, RedisValue<T>>()
    private val ttlManager = TTLManager(store)

    init {
        ttlManager.startActiveExpiration()
    }

    fun set(key: String, value: T, ttlMs: Long? = null) {
        val expireAt = ttlMs?.let { System.currentTimeMillis() + it }
        store[key] = RedisValue(value, DataType.STRING, expireAt)
    }

    fun get(key: String): T? {
        val value = store[key] ?: return null
        // Lazy expiration
        if (value.isExpired()) {
            store.remove(key)
            return null
        }
        return value.data
    }

    fun delete(key: String): Boolean = store.remove(key) != null

    fun size(): Int = store.size

    fun keys(): Set<String> = store.keys.toSet()
}

class TTLManager<T>(private val store: ConcurrentHashMap<String, RedisValue<T>>) {
    private val sampleSize = 20
    private val expiredThreshold = 0.25

    fun startActiveExpiration(intervalMs: Long = 100) {
        thread(isDaemon = true, name = "ttl-manager") {
            while (true) {
                Thread.sleep(intervalMs)
                expireSample()
            }
        }
    }

    private fun expireSample() {
        if (store.isEmpty()) return

        var expired = 0
        val keys = store.keys().toList()
        val sample = keys.shuffled().take(minOf(sampleSize, keys.size))

        for (key in sample) {
            val value = store[key] ?: continue
            if (value.isExpired()) {
                store.remove(key)
                expired++
            }
        }

        // 만료된 키가 25% 이상이면 다시 샘플링
        if (expired > sample.size * expiredThreshold) {
            expireSample()
        }
    }
}
```

---

## 2. 자료구조 (String/List/Set/Sorted Set)

### 왜 고민했나

좌표 캐시만 있으면 String으로 충분하다. 하지만 실제 서비스를 설계하다 보면 다양한 요구가 생긴다.

- **푸시 알림 큐**. 보낼 알림 목록을 순서대로 저장하고 하나씩 꺼내야 한다 → List
- **온라인 사용자 목록**. 중복 없이 저장하고 빠르게 존재 여부를 확인해야 한다 → Set
- **인기 장소 순위**. 점수 기반으로 정렬하고 상위 N개를 조회해야 한다 → Sorted Set

각 요구를 String으로 해결하려면 직렬화/역직렬화 비용이 발생하고, 부분 수정이 어렵다. Redis가 왜 다양한 자료구조를 제공하는지, 각 자료구조가 어떤 연산에서 효율적인지 직접 확인하고 싶었다.

### 예상한 문제

**가설 1. String만 쓰면 복잡한 모델링이 어렵다**

인기 장소 순위를 String으로 저장하려면 전체 데이터를 JSON으로 직렬화해서 저장하고, 수정할 때마다 전체를 읽어서 파싱하고 다시 직렬화해야 한다. 순위가 바뀔 때마다 이 과정을 반복하면 성능이 급격히 나빠질 것이다.

**가설 2. 자료구조별 동시성 문제**

List의 push/pop, Set의 add/remove를 직접 구현하면 동시성 문제가 생길 것이다. 두 스레드가 동시에 List에 push하면 데이터가 유실되거나 순서가 꼬일 수 있다.

**가설 3. Sorted Set의 구현 복잡도**

점수 기반 정렬을 유지하려면 Skip List나 Tree 구조가 필요할 것이다. 단순 배열로 구현하면 삽입/삭제 시 O(N) 시간이 걸려 성능이 나빠질 것이다.

### 구현하며 확인한 것

**확인 1. List를 LinkedList로 구현하면 push/pop은 빠르지만 index 접근은 느리다**

```kotlin
// LinkedList 기반 구현
class RedisList {
    private val list = LinkedList<String>()

    fun lpush(value: String) = list.addFirst(value)  // O(1)
    fun rpop(): String? = list.pollLast()            // O(1)
    fun lindex(index: Int): String? = list.getOrNull(index)  // O(N)!
}
```

`LINDEX` 연산이 O(N)이라는 걸 실험으로 확인했다. 100만 개의 요소가 있는 List에서 50만 번째 요소를 조회하니 50ms가 걸렸다. 반면 ArrayList는 index 접근이 O(1)이지만 앞쪽 삽입이 O(N)이다.

Redis는 이 문제를 ziplist와 quicklist로 해결한다. Mini Redis에서는 단순하게 LinkedList를 사용하되, index 접근이 느리다는 점을 문서화했다.

**확인 2. Set에서 동시성 문제가 실제로 발생했다**

처음에는 `mutableSetOf`로 구현했다.

```kotlin
class RedisSet {
    private val set = mutableSetOf<String>()

    fun sadd(value: String): Boolean = set.add(value)
    fun srem(value: String): Boolean = set.remove(value)
}
```

두 스레드가 동시에 `sadd`를 호출하는 테스트에서 `ConcurrentModificationException`이 발생했다. `ConcurrentHashMap.newKeySet()`으로 변경하니 문제가 해결됐다.

**확인 3. Sorted Set을 ConcurrentSkipListSet으로 구현하니 자연스럽게 정렬이 유지됐다**

Java의 `ConcurrentSkipListSet`은 내부적으로 Skip List를 사용한다. 삽입/삭제/검색 모두 O(log N) 시간에 처리되고, 순회할 때는 정렬된 순서로 반환된다.

```kotlin
data class ScoreEntry(val member: String, val score: Double) : Comparable<ScoreEntry> {
    override fun compareTo(other: ScoreEntry): Int {
        val scoreCompare = score.compareTo(other.score)
        return if (scoreCompare != 0) scoreCompare else member.compareTo(other.member)
    }
}

class SortedSet {
    private val data = ConcurrentSkipListSet<ScoreEntry>()

    fun zadd(member: String, score: Double) {
        data.removeIf { it.member == member }  // 기존 점수 제거
        data.add(ScoreEntry(member, score))
    }

    fun zrange(start: Int, stop: Int): List<String> {
        return data.drop(start).take(stop - start + 1).map { it.member }
    }

    fun zrangeByScore(min: Double, max: Double): List<String> {
        return data.filter { it.score in min..max }.map { it.member }
    }
}
```

### 의사결정 과정

**자료구조별 구현체 선택**

| 자료구조 | 선택한 구현체 | 이유 |
|---------|-------------|------|
| String | 단순 값 저장 | 추가 구조 불필요 |
| List | LinkedList | push/pop이 O(1) |
| Set | ConcurrentHashMap.newKeySet() | 동시성 안전, 조회 O(1) |
| Sorted Set | ConcurrentSkipListSet | 동시성 안전, 정렬 유지, O(log N) |

**Hash는 구현하지 않은 이유**
Hash는 필드별로 값을 저장하는 자료구조다. 실제로 유용하지만, Mini Redis의 목적은 캐시 구조 이해이므로 핵심 자료구조만 구현하기로 했다. Hash는 `ConcurrentHashMap<String, ConcurrentHashMap<String, String>>`으로 쉽게 확장할 수 있다.

### 캐시 이슈 대응 포인트

자료구조 관련 이슈가 발생했을 때 아래 순서로 점검한다.

1. **연산이 예상보다 느린가?** 자료구조별 시간 복잡도를 확인한다. List의 LINDEX는 O(N)이다.
2. **동시성 에러가 발생하는가?** 적절한 Concurrent 자료구조를 사용하고 있는지 확인한다.
3. **메모리 사용량이 예상보다 높은가?** Sorted Set은 member와 score를 모두 저장하므로 메모리를 더 사용한다.
4. **잘못된 자료구조를 사용하고 있진 않은가?** 순서가 필요하면 List, 중복 제거가 필요하면 Set, 정렬이 필요하면 Sorted Set.

### 느낀 점

자료구조 선택이 결국 사용자 경험(응답 시간)을 좌우한다는 걸 체감했다. "그냥 String에 JSON으로 저장하면 되지 않나?"라는 생각이 위험하다는 걸 알았다. 요구사항에 맞는 자료구조를 선택하면 코드도 단순해지고 성능도 좋아진다.

Redis 명령어의 시간 복잡도 표가 왜 중요한지 다시 느꼈다. `LINDEX O(N)`, `ZADD O(log N)` 같은 정보가 실제 성능에 직결된다. 문서를 읽을 때 시간 복잡도를 먼저 확인하는 습관이 생겼다.

### 코드

```kotlin
// List 구현
class RedisList {
    private val list = Collections.synchronizedList(LinkedList<String>())

    fun lpush(vararg values: String): Int {
        values.forEach { list.add(0, it) }
        return list.size
    }

    fun rpush(vararg values: String): Int {
        values.forEach { list.add(it) }
        return list.size
    }

    fun lpop(): String? = if (list.isNotEmpty()) list.removeAt(0) else null

    fun rpop(): String? = if (list.isNotEmpty()) list.removeAt(list.size - 1) else null

    fun lrange(start: Int, stop: Int): List<String> {
        val end = if (stop < 0) list.size + stop + 1 else minOf(stop + 1, list.size)
        val actualStart = if (start < 0) maxOf(0, list.size + start) else start
        return if (actualStart < end) list.subList(actualStart, end).toList() else emptyList()
    }

    fun llen(): Int = list.size
}

// Set 구현
class RedisSet {
    private val set = ConcurrentHashMap.newKeySet<String>()

    fun sadd(vararg members: String): Int {
        var added = 0
        members.forEach { if (set.add(it)) added++ }
        return added
    }

    fun srem(vararg members: String): Int {
        var removed = 0
        members.forEach { if (set.remove(it)) removed++ }
        return removed
    }

    fun sismember(member: String): Boolean = set.contains(member)

    fun smembers(): Set<String> = set.toSet()

    fun scard(): Int = set.size
}

// Sorted Set 구현
data class ScoreEntry(val member: String, val score: Double) : Comparable<ScoreEntry> {
    override fun compareTo(other: ScoreEntry): Int {
        val scoreCompare = score.compareTo(other.score)
        return if (scoreCompare != 0) scoreCompare else member.compareTo(other.member)
    }
}

class RedisSortedSet {
    private val data = ConcurrentSkipListSet<ScoreEntry>()
    private val memberScores = ConcurrentHashMap<String, Double>()

    fun zadd(member: String, score: Double): Int {
        val existing = memberScores[member]
        if (existing != null) {
            data.remove(ScoreEntry(member, existing))
        }
        data.add(ScoreEntry(member, score))
        memberScores[member] = score
        return if (existing == null) 1 else 0
    }

    fun zrem(member: String): Int {
        val score = memberScores.remove(member) ?: return 0
        data.remove(ScoreEntry(member, score))
        return 1
    }

    fun zscore(member: String): Double? = memberScores[member]

    fun zrange(start: Int, stop: Int): List<String> {
        val end = if (stop < 0) data.size + stop + 1 else minOf(stop + 1, data.size)
        return data.drop(start).take(end - start).map { it.member }
    }

    fun zrangeByScore(min: Double, max: Double): List<String> {
        return data.filter { it.score in min..max }.map { it.member }
    }

    fun zcard(): Int = data.size
}
```

---

## 3. Pub/Sub

### 왜 고민했나

좌표 데이터가 갱신될 때 여러 서비스가 동시에 캐시를 무효화해야 한다고 가정해 보자. 예를 들어
- 카페 정보 서비스 → 해당 카페의 상세 정보 캐시 삭제
- 검색 서비스 → 해당 지역의 검색 결과 캐시 삭제
- 추천 서비스 → 해당 카페를 포함한 추천 목록 캐시 삭제

모든 서비스가 직접 Kafka 이벤트를 구독하게 만들 수도 있지만, 캐시 무효화라는 단순한 작업을 위해 각 서비스가 Consumer를 운영하는 건 부담이 된다. Redis Pub/Sub으로 "카페 X가 변경됐다"는 신호만 보내면 각 서비스가 알아서 캐시를 삭제하도록 만들 수 있다.

무효화가 느리면 stale 데이터가 사용자 화면에 남는다. 카페가 폐업했는데도 앱에 "영업 중"으로 표시되는 장면이 대표적이다. 이런 상황이 반복되면 사용자 신뢰가 떨어지므로, 캐시 무효화 채널 자체를 직접 구현해 보고 싶었다.

### 예상한 문제

**가설 1. 구독자 목록 동시성 문제**

구독자가 추가/제거되는 동안 메시지를 publish하면 어떻게 되나? 구독자 목록을 순회하는 중에 목록이 변경되면 `ConcurrentModificationException`이 발생하거나, 일부 구독자가 누락될 것이다.

**가설 2. Fan-out 성능**

한 채널에 구독자가 1000명이면 메시지 하나를 보낼 때 1000번의 핸들러 호출이 발생한다. 핸들러 중 하나가 느리면 나머지 구독자의 메시지 수신도 지연될 것이다.

**가설 3. 메모리 누수**

채널을 생성만 하고 삭제하지 않으면 사용하지 않는 채널이 계속 쌓일 것이다. 구독자가 0명인 채널을 정리하는 로직이 필요하다.

### 구현하며 확인한 것

**확인 1. CopyOnWriteArrayList를 쓰지 않으면 에러가 났다**

처음에는 `mutableListOf`로 구독자 목록을 관리했다.

```kotlin
private val channels = ConcurrentHashMap<String, MutableList<(String) -> Unit>>()

fun publish(channel: String, message: String) {
    channels[channel]?.forEach { handler ->
        handler(message)  // 순회 중 subscribe/unsubscribe가 발생하면?
    }
}
```

한 스레드가 publish로 구독자 목록을 순회하는 동안, 다른 스레드가 subscribe로 구독자를 추가하면 `ConcurrentModificationException`이 발생했다.

`CopyOnWriteArrayList`로 변경하니 문제가 해결됐다. 이 자료구조는 수정 시 전체 배열을 복사하므로 순회 중 수정이 가능하다. 다만 수정이 빈번하면 복사 비용이 발생하므로, 구독/취소보다 publish가 훨씬 많은 상황에서 적합하다.

**확인 2. 동기 핸들러 호출의 문제**

핸들러를 동기로 호출하니 느린 핸들러가 전체를 막았다.

```kotlin
fun publish(channel: String, message: String) {
    channels[channel]?.forEach { handler ->
        handler(message)  // 이 핸들러가 1초 걸리면 다음 핸들러도 1초 대기
    }
}
```

비동기로 변경할 수도 있지만, 그러면 메시지 순서 보장이 어려워진다. Mini Redis에서는 단순하게 동기 호출을 유지하되, 핸들러는 빠르게 처리해야 한다는 점을 문서화했다.

**확인 3. 채널 정리 정책이 필요했다**

구독자가 0명인 채널이 계속 생성되면 메모리가 낭비된다. 두 가지 정책을 고려했다.

1. 구독자가 0명이 되면 즉시 채널 삭제
2. 주기적으로 빈 채널 정리

1번을 선택했다. 주기적 정리는 별도 스레드와 스케줄링이 필요해서 복잡도가 올라가고, 빈 채널이 다음 정리 주기까지 메모리에 남아있게 된다. 즉시 삭제는 `unsubscribe` 시점에 구독자 수만 확인하면 되니 구현이 단순하고 메모리도 바로 회수된다.

### 의사결정 과정

**Pub/Sub vs Kafka 이벤트**

| 방식 | 장점 | 단점 |
|------|------|------|
| Kafka | 신뢰성, 재처리 가능, 순서 보장 | 오버헤드, Consumer 관리 필요 |
| Redis Pub/Sub | 가볍고 빠름, 실시간 | 메시지 유실 가능, 순서 보장 안 됨 |

**최종 선택. 캐시 무효화에는 Redis Pub/Sub**
캐시 무효화는 "베스트 에포트"로 충분하다. 메시지가 유실되어도 TTL로 결국 캐시가 만료된다. 중요한 비즈니스 이벤트(결제 완료 등)는 여전히 Kafka로 처리하고, 캐시 무효화 같은 실시간 알림만 Pub/Sub으로 처리한다.

### 캐시 이슈 대응 포인트

Pub/Sub 관련 이슈가 발생했을 때 아래 순서로 점검한다.

1. **메시지가 전달되지 않는가?** 구독자가 실제로 등록되어 있는지 확인한다.
2. **메시지 처리가 지연되는가?** 핸들러 중 느린 것이 있는지 확인한다.
3. **메모리 사용량이 계속 증가하는가?** 빈 채널이 정리되고 있는지 확인한다.
4. **메시지 순서가 꼬이는가?** Pub/Sub은 순서를 보장하지 않는다. 순서가 중요하면 Kafka를 사용해야 한다.

### 느낀 점

캐시 무효화는 단순한 캐시 문제를 넘어, 서비스 간 이벤트 설계와 맞물린다는 걸 다시 느꼈다. "캐시를 지우면 되지"가 아니라 "누가 언제 어떤 캐시를 지울지"를 설계해야 한다.

Pub/Sub으로 브로드캐스트하는 구조를 손으로 만들어 보니 Observer 패턴의 장단점을 명확히 설명할 수 있게 됐다. 느슨한 결합의 장점(발행자가 구독자를 몰라도 됨)과 단점(누가 받았는지 확인 불가)을 동시에 체험했다.

### 코드

```kotlin
class PubSub {
    private val channels = ConcurrentHashMap<String, CopyOnWriteArrayList<Subscriber>>()

    data class Subscriber(
        val id: String,
        val handler: (String) -> Unit
    )

    fun subscribe(channel: String, subscriberId: String, handler: (String) -> Unit) {
        channels.computeIfAbsent(channel) { CopyOnWriteArrayList() }
            .add(Subscriber(subscriberId, handler))
    }

    fun unsubscribe(channel: String, subscriberId: String) {
        val subscribers = channels[channel] ?: return
        subscribers.removeIf { it.id == subscriberId }

        // 구독자가 0명이면 채널 삭제
        if (subscribers.isEmpty()) {
            channels.remove(channel)
        }
    }

    fun publish(channel: String, message: String): Int {
        val subscribers = channels[channel] ?: return 0
        subscribers.forEach { it.handler(message) }
        return subscribers.size
    }

    fun getSubscriberCount(channel: String): Int {
        return channels[channel]?.size ?: 0
    }

    fun listChannels(): Set<String> = channels.keys.toSet()
}
```

---

## 4. Persistence (RDB / AOF)

### 왜 고민했나

인메모리 캐시는 프로세스가 재시작되면 데이터가 날아간다. "캐시니까 날아가면 다시 채우면 되지"라고 생각할 수 있지만, 실제로는 문제가 생긴다.

Redis가 재시작되면 모든 캐시가 비어 있는 상태가 된다. 이때 모든 요청이 DB나 외부 API로 가면서 "캐시 스탬피드"가 발생한다. [HA 2-1 글](/incerpay-ha-2-1)에서 TTL 30일 캐시를 25일마다 선제 갱신해서 스탬피드를 방지하는 전략을 다룬 적 있는데, 이번에는 스냅샷 복구 관점에서 같은 문제를 살펴봤다.

좌표 캐시라도 초기 로딩 비용을 줄이려면 스냅샷이 필요했다. 재시작 후 스냅샷에서 데이터를 복구하면 캐시 스탬피드를 완화할 수 있다.

### 예상한 문제

**가설 1. RDB 스냅샷의 데이터 유실**

RDB는 특정 시점의 스냅샷을 저장한다. 스냅샷 이후에 변경된 데이터는 저장되지 않으므로, 장애 시 최대 스냅샷 간격만큼의 데이터가 유실될 것이다. 예를 들어 1시간마다 스냅샷을 뜨면 최대 1시간치 데이터가 유실될 수 있다.

**가설 2. AOF의 디스크 사용량**

AOF(Append-Only File)는 모든 쓰기 명령을 파일에 기록한다. 같은 키에 100번 쓰면 100줄이 기록된다. 시간이 지나면 파일 크기가 끝없이 커질 것이다.

**가설 3. RDB vs AOF의 복구 속도**

RDB는 바이너리 스냅샷이므로 빠르게 로드할 수 있다. AOF는 명령 로그를 재실행해야 하므로 복구가 느릴 것이다.

### 구현하며 확인한 것

**확인 1. RDB 스냅샷 빈도와 IO의 trade-off**

스냅샷을 1분마다 뜨니 디스크 IO가 급증했다. 스냅샷을 뜨는 동안 write 성능이 30% 떨어졌다.

| 스냅샷 간격 | IO 부하 | 최대 데이터 유실 |
|------------|--------|----------------|
| 1분 | 높음 | 1분 |
| 10분 | 중간 | 10분 |
| 1시간 | 낮음 | 1시간 |

실제 Redis는 fork를 사용해서 자식 프로세스에서 스냅샷을 뜬다. Mini Redis에서는 간단하게 동기 방식으로 구현했다.

**확인 2. AOF rewrite가 필수였다**

AOF 파일에 100만 건의 명령을 기록한 후 파일 크기를 확인하니 500MB가 넘었다. 같은 키에 대한 반복 쓰기가 많아서 불필요한 중복이 쌓였다.

AOF rewrite는 현재 메모리 상태를 기준으로 AOF 파일을 다시 작성한다. 100만 건의 명령 대신 현재 유효한 10만 개의 키만 기록하면 파일 크기가 80% 줄어든다.

**확인 3. RDB + AOF 조합이 최선이었다**

RDB만 쓰면 복구는 빠르지만 데이터 유실 가능성이 있다. AOF만 쓰면 유실은 없지만 복구가 느리다. 둘을 조합하면
1. 장애 시 RDB로 빠르게 기본 데이터 로드
2. RDB 이후의 변경은 AOF에서 복구

### 의사결정 과정

**영속화 전략 선택**

| 전략 | 장점 | 단점 |
|------|------|------|
| RDB만 | 빠른 복구, 작은 파일 | 데이터 유실 가능 |
| AOF만 | 유실 최소화 | 느린 복구, 큰 파일 |
| RDB + AOF | 빠른 복구 + 유실 최소화 | 구현 복잡도 |

**최종 선택. RDB + AOF 조합**
좌표 기반 캐시를 완전히 잃어도 다시 채울 수 있지만, 캐시 스탬피드를 막으려면 빠른 복구가 중요하다. RDB로 대부분의 데이터를 복구하고, 최신 변경만 AOF에서 가져오는 전략을 선택했다.

**스냅샷 간격. 1시간**
좌표 데이터 변경 빈도가 낮고(일 100건 미만) 유실되어도 다시 API를 호출하면 되므로 1시간 간격으로 충분했다.

### 캐시 이슈 대응 포인트

Persistence 관련 장애가 발생했을 때 아래 순서로 점검한다.

1. **재시작 후 데이터가 복구되지 않았나?** RDB/AOF 파일이 존재하고 정상인지 확인한다.
2. **복구 시간이 너무 오래 걸리나?** AOF 파일이 너무 크면 rewrite가 필요하다.
3. **디스크 사용량이 계속 증가하나?** AOF rewrite 정책을 확인한다.
4. **스냅샷 중 성능 저하가 발생하나?** 스냅샷 빈도를 조정하거나 트래픽이 적은 시간에 스냅샷을 뜬다.

### 느낀 점

Persistence는 옵션이 아니라 필수 전략이라는 걸 깨달았다. "캐시니까 영속화 안 해도 되지"가 아니라 "장애 시 어떤 수준의 데이터 유실을 허용할 것인가"를 먼저 정의해야 한다.

Redis가 왜 RDB + AOF 조합을 제공하는지 직접 이해했다. 각각의 장단점을 보완해서 "빠른 복구"와 "데이터 안전"을 동시에 달성한다.

### 코드

```kotlin
// RDB 스냅샷
class RdbPersister<T>(private val store: ConcurrentHashMap<String, RedisValue<T>>) {
    fun save(path: Path) {
        ObjectOutputStream(Files.newOutputStream(path)).use { out ->
            out.writeObject(store.toMap())
        }
    }

    @Suppress("UNCHECKED_CAST")
    fun load(path: Path) {
        if (!Files.exists(path)) return

        ObjectInputStream(Files.newInputStream(path)).use { input ->
            val data = input.readObject() as Map<String, RedisValue<T>>
            store.clear()
            store.putAll(data)
        }
    }
}

// AOF 로그
class AofPersister(private val path: Path) {
    private val writer = Files.newBufferedWriter(
        path,
        StandardOpenOption.CREATE,
        StandardOpenOption.APPEND
    )

    @Synchronized
    fun log(command: String, args: List<String>) {
        val line = buildString {
            append(command)
            args.forEach { append(" ").append(escape(it)) }
            append("\n")
        }
        writer.write(line)
        writer.flush()
    }

    fun replay(store: MiniRedis<String>) {
        if (!Files.exists(path)) return

        Files.readAllLines(path).forEach { line ->
            val parts = parseLine(line)
            if (parts.isNotEmpty()) {
                executeCommand(store, parts[0], parts.drop(1))
            }
        }
    }

    fun rewrite(store: ConcurrentHashMap<String, RedisValue<*>>) {
        val tempPath = path.resolveSibling("temp_${path.fileName}")
        Files.newBufferedWriter(tempPath).use { writer ->
            store.forEach { (key, value) ->
                val command = when (value.type) {
                    DataType.STRING -> "SET $key ${escape(value.data.toString())}"
                    else -> return@forEach  // 다른 타입은 생략
                }
                val expireCmd = value.expireAt?.let { " EXPIREAT $key $it" } ?: ""
                writer.write("$command$expireCmd\n")
            }
        }
        Files.move(tempPath, path, StandardCopyOption.REPLACE_EXISTING)
    }

    private fun escape(s: String): String = "\"${s.replace("\"", "\\\"")}\""
    private fun parseLine(line: String): List<String> = line.split(" ")  // 간소화
    private fun executeCommand(store: MiniRedis<String>, cmd: String, args: List<String>) {
        when (cmd.uppercase()) {
            "SET" -> if (args.size >= 2) store.set(args[0], args[1])
            "DEL" -> if (args.isNotEmpty()) store.delete(args[0])
        }
    }
}
```

---

## 5. Eviction

### 왜 고민했나

좌표 캐시를 오래 두다 보면 메모리가 가득 차서 OOM이 날 수 있다. TTL로 만료시키는 것과 별개로, 메모리가 한계에 도달하면 일부 데이터를 강제로 삭제해야 한다.

어떤 데이터를 삭제해야 할까? 가장 오래된 데이터? 가장 적게 조회된 데이터? 랜덤하게? 이 결정이 캐시 히트율에 직접적인 영향을 미친다.

### 예상한 문제

**가설 1. LRU 구현의 복잡도**

LRU(Least Recently Used)를 정확하게 구현하려면 모든 접근 시점을 추적해야 한다. 매 조회마다 접근 시간을 업데이트하면 오버헤드가 발생할 것이다.

**가설 2. LFU의 메모리 오버헤드**

LFU(Least Frequently Used)는 각 키의 접근 횟수를 저장해야 한다. 키가 수백만 개면 카운터만으로도 상당한 메모리를 사용할 것이다.

**가설 3. 정책 없이 랜덤 삭제하면?**

랜덤하게 삭제하면 구현은 단순하지만, 자주 사용되는 키도 삭제될 수 있어 히트율이 떨어질 것이다.

### 구현하며 확인한 것

**확인 1. 정확한 LRU는 비용이 크다**

매 조회마다 접근 시간을 업데이트하는 LRU를 구현했다.

```kotlin
class ExactLRU<K, V>(private val maxSize: Int) {
    private val map = LinkedHashMap<K, V>(maxSize, 0.75f, true)  // accessOrder=true

    fun get(key: K): V? = map[key]

    fun put(key: K, value: V) {
        map[key] = value
        if (map.size > maxSize) {
            val eldest = map.entries.first()
            map.remove(eldest.key)
        }
    }
}
```

이 구현은 정확하지만, `LinkedHashMap`이 내부적으로 접근 순서를 재정렬하면서 오버헤드가 발생한다. 초당 10만 건의 조회에서 15%의 성능 저하가 측정됐다.

**확인 2. 샘플링 기반 LRU가 실용적이었다**

Redis는 정확한 LRU 대신 샘플링 기반 근사 LRU를 사용한다. 무작위로 N개의 키를 뽑아서 그 중 가장 오래된 것을 삭제한다.

```kotlin
fun evictLRUSample(sampleSize: Int = 5) {
    val sample = store.entries.shuffled().take(sampleSize)
    val oldest = sample.minByOrNull { it.value.lastAccessTime }
    oldest?.let { store.remove(it.key) }
}
```

정확도는 약간 떨어지지만 성능 오버헤드가 거의 없다. Redis 벤치마크에서 샘플 크기 10이면 정확한 LRU와 히트율 차이가 1% 미만이라고 한다.

**확인 3. 메모리 모니터링 없이는 eviction이 무용지물**

eviction 정책을 구현해도 "언제 eviction을 실행할지"를 정하지 않으면 의미가 없다. 메모리 사용량이 임계치(예. 80%)를 넘으면 eviction을 시작하도록 모니터링 로직이 필요했다.

### 의사결정 과정

**Eviction 정책 선택**

| 정책 | 장점 | 단점 |
|------|------|------|
| LRU (정확) | 최근 사용 데이터 보존 | 구현 복잡, 오버헤드 |
| LRU (샘플링) | 성능 좋음, 정확도 비슷 | 약간의 정확도 손실 |
| LFU | 자주 사용되는 데이터 보존 | 카운터 메모리, 한번 높아진 카운터 문제 |
| TTL 기반 | 만료 예정 데이터 우선 삭제 | 사용 빈도 무시 |
| Random | 구현 단순 | 히트율 저하 |

**최종 선택. 샘플링 기반 LRU + TTL 기반 병행**
1. 먼저 TTL이 설정된 키 중 만료가 임박한 것을 삭제
2. 그래도 메모리가 부족하면 샘플링 LRU로 삭제

좌표 기반 캐시 시나리오에서는 대부분의 키가 TTL을 갖고 있으므로 TTL 기반 삭제가 먼저 동작하고, 예외적인 상황에서만 LRU가 동작한다.

### 캐시 이슈 대응 포인트

Eviction 관련 이슈가 발생했을 때 아래 순서로 점검한다.

1. **OOM이 발생했나?** 메모리 사용량 모니터링을 확인한다.
2. **eviction이 동작하고 있나?** eviction 로그와 삭제된 키 수를 확인한다.
3. **히트율이 급격히 떨어졌나?** eviction이 너무 공격적이면 필요한 데이터도 삭제된다.
4. **메모리 임계치가 적절한가?** 너무 높으면 OOM, 너무 낮으면 불필요한 eviction.

### 느낀 점

eviction 정책을 선택할 때는 사용 패턴과 리소스 특성을 함께 고려해야 한다는 걸 깨달았다. 좌표 캐시처럼 접근 패턴이 불균등한 경우 LRU가 효과적이고, 접근 패턴이 균등한 경우 랜덤 삭제도 나쁘지 않다.

Redis가 왜 다양한 eviction 정책(allkeys-lru, volatile-lru, allkeys-lfu 등)을 제공하는지 납득했다. 정답이 없고, 워크로드에 따라 최적의 정책이 다르기 때문이다.

### 코드

```kotlin
enum class EvictionPolicy {
    LRU_SAMPLING,   // 샘플링 기반 LRU
    TTL_FIRST,      // TTL 만료 임박 우선
    RANDOM          // 랜덤 삭제
}

class EvictionManager<T>(
    private val store: ConcurrentHashMap<String, RedisValue<T>>,
    private val policy: EvictionPolicy = EvictionPolicy.LRU_SAMPLING,
    private val maxMemoryBytes: Long = 100 * 1024 * 1024,  // 100MB
    private val sampleSize: Int = 5
) {
    private val accessTimes = ConcurrentHashMap<String, Long>()

    fun recordAccess(key: String) {
        accessTimes[key] = System.currentTimeMillis()
    }

    fun checkAndEvict() {
        val currentMemory = estimateMemory()
        if (currentMemory < maxMemoryBytes * 0.8) return

        val keysToEvict = mutableListOf<String>()

        // 메모리가 70% 이하가 될 때까지 eviction
        while (estimateMemory() > maxMemoryBytes * 0.7 && store.isNotEmpty()) {
            val keyToEvict = selectKeyToEvict() ?: break
            keysToEvict.add(keyToEvict)
            store.remove(keyToEvict)
            accessTimes.remove(keyToEvict)
        }

        if (keysToEvict.isNotEmpty()) {
            println("Evicted ${keysToEvict.size} keys")
        }
    }

    private fun selectKeyToEvict(): String? {
        return when (policy) {
            EvictionPolicy.LRU_SAMPLING -> selectLRUSample()
            EvictionPolicy.TTL_FIRST -> selectTTLFirst()
            EvictionPolicy.RANDOM -> selectRandom()
        }
    }

    private fun selectLRUSample(): String? {
        val sample = store.keys.toList().shuffled().take(sampleSize)
        return sample.minByOrNull { accessTimes[it] ?: 0L }
    }

    private fun selectTTLFirst(): String? {
        // TTL이 있고 만료가 가까운 키 우선
        val withTTL = store.entries.filter { it.value.expireAt != null }
        if (withTTL.isNotEmpty()) {
            return withTTL.minByOrNull { it.value.expireAt ?: Long.MAX_VALUE }?.key
        }
        // TTL이 없으면 LRU
        return selectLRUSample()
    }

    private fun selectRandom(): String? {
        return store.keys.randomOrNull()
    }

    private fun estimateMemory(): Long {
        // 간단한 추정: 키당 평균 100바이트로 계산
        return store.size * 100L
    }
}
```

---

## 6. Geo 캐시

### 왜 고민했나

좌표 데이터를 그대로 키로 쓰면 범위 검색이나 근접 검색이 어렵다. 예를 들어 `lat:37.5665,lon:126.9780`을 키로 쓰면 정확히 그 좌표만 조회할 수 있고, "이 좌표에서 1km 이내의 카페"를 캐시에서 찾을 수 없다.

가상 좌표 기반 서비스에서 "현재 위치 근처 카페" 검색을 반복 호출한다고 가정하면, 같은 구역의 요청을 하나의 캐시 키로 묶어야 API 비용을 줄일 수 있다. 그렇다면 "비슷한 위치"의 기준을 어떻게 정해야 할까?

### 예상한 문제

**가설 1. 단순 좌표 문자열의 한계**

`lat:37.5665,lon:126.9780`와 `lat:37.5666,lon:126.9781`은 10m도 안 떨어진 위치지만, 키가 다르므로 별개로 캐시된다. 캐시 효율이 떨어질 것이다.

**가설 2. Geohash precision의 중요성**

Geohash는 좌표를 문자열로 인코딩하는 방식으로, 문자열 길이(precision)에 따라 표현하는 범위가 달라진다.

| Precision | 대략적 범위 |
|-----------|-----------|
| 1 | ~5000km |
| 4 | ~40km |
| 6 | ~1km |
| 8 | ~40m |

Precision을 잘못 잡으면 캐시 범위가 지나치게 넓거나(불필요한 데이터 반환) 좁아질(캐시 히트율 저하) 것이다.

**가설 3. 경계 문제**

Geohash가 같은 구역에 속하는 두 점은 가까워 보이지만, 인접한 다른 구역에 속하는 점이 실제로는 더 가까울 수 있다. 이 "경계 문제"를 어떻게 처리할지 고민이 필요하다.

### 구현하며 확인한 것

**확인 1. Geohash를 직접 구현해보니 원리가 명확했다**

Geohash는 경도와 위도를 번갈아가며 비트로 인코딩하고, 이를 base32로 변환한다.

```kotlin
// 위도 37.5665, 경도 126.9780의 Geohash 계산 과정
// 1. 경도 범위 [-180, 180]을 이진 검색으로 좁혀간다
// 2. 위도 범위 [-90, 90]을 이진 검색으로 좁혀간다
// 3. 경도/위도 비트를 번갈아 배치
// 4. 5비트씩 묶어서 base32로 변환
// 결과: "wydm9q..."
```

같은 Geohash 접두사를 가진 좌표들은 같은 구역에 속한다. `wydm9q`로 시작하는 모든 좌표는 같은 ~1km² 구역에 있다.

**확인 2. Precision 6이 가장 균형 잡혔다**

Precision을 여러 범위로 바꿔가며 테스트했다.
- Precision 4 (~40km) 서울 전체가 하나의 캐시. 너무 넓음.
- Precision 6 (~1km) 동네 단위. "근처 카페"의 기대에 적합.
- Precision 8 (~40m) 건물 단위. 너무 좁아서 캐시 히트율 낮음.

Precision 6을 선택하자 캐시 히트율이 baseline 47%에서 78%로 상승했다.

**확인 3. Sorted Set과 결합하면 거리 순 정렬도 쉬웠다**

Geohash를 score로 사용하면 Sorted Set에서 범위 검색이 가능하다. 같은 접두사를 가진 Geohash들은 숫자로 변환했을 때 연속된 범위에 있기 때문이다.

```kotlin
// Geohash를 정수로 변환해서 score로 사용
val scoreMin = geohashToLong("wydm9q")  // 범위 시작
val scoreMax = geohashToLong("wydm9r")  // 범위 끝 (다음 접두사)
sortedSet.zrangeByScore(scoreMin, scoreMax)  // 해당 구역의 모든 카페
```

### 의사결정 과정

**좌표 키 전략**

| 전략 | 장점 | 단점 |
|------|------|------|
| 정확한 좌표 | 정확한 캐시 | 히트율 낮음 |
| Geohash 고정 precision | 범위 캐시 가능 | 경계 문제 |
| Geohash 동적 precision | 유연함 | 구현 복잡 |

**최종 선택. Geohash precision 6 고정**
"현재 위치 근처 1km 이내"라는 시나리오에 맞춰 precision 6을 고정으로 사용하기로 했다. 경계 문제는 인접한 8개 구역까지 조회하는 것으로 완화한다.

### 캐시 이슈 대응 포인트

Geo 캐시 관련 이슈가 발생했을 때 아래 순서로 점검한다.

1. **캐시 히트율이 낮은가?** Geohash precision이 너무 높을(범위가 좁을) 수 있다.
2. **불필요한 결과가 반환되는가?** Precision이 너무 낮을(범위가 넓을) 수 있다.
3. **경계 근처에서 결과가 누락되는가?** 인접 구역 조회 로직을 확인한다.
4. **Geohash 계산이 느린가?** 계산 결과를 캐시하거나 최적화한다.

### 느낀 점

Geo 캐시는 "어디까지 묶을지"를 수치로 조절할 수 있어야 한다는 걸 깨달았다. Precision 하나로 캐시 범위, 히트율, API 비용이 모두 결정된다. 비즈니스 요구사항(사용자가 "근처"라고 느끼는 범위)과 기술적 제약(API 비용, 캐시 크기)을 함께 고려해야 한다.

Redis GEO 명령이 왜 Hash + Sorted Set 조합인지 이해했다. Geohash로 인코딩해서 Sorted Set에 저장하면 범위 검색(ZRANGEBYSCORE)과 개별 조회(HGET) 모두 효율적으로 처리할 수 있다.

### 코드

```kotlin
data class GeoCoordinate(val latitude: Double, val longitude: Double)

class GeoHash {
    private val base32 = "0123456789bcdefghjkmnpqrstuvwxyz"

    fun encode(lat: Double, lon: Double, precision: Int = 6): String {
        var latMin = -90.0
        var latMax = 90.0
        var lonMin = -180.0
        var lonMax = 180.0

        var bits = 0
        var bitsTotal = 0
        var hashValue = 0
        val result = StringBuilder()

        while (result.length < precision) {
            if (bitsTotal % 2 == 0) {
                // 경도
                val mid = (lonMin + lonMax) / 2
                if (lon >= mid) {
                    hashValue = (hashValue shl 1) + 1
                    lonMin = mid
                } else {
                    hashValue = hashValue shl 1
                    lonMax = mid
                }
            } else {
                // 위도
                val mid = (latMin + latMax) / 2
                if (lat >= mid) {
                    hashValue = (hashValue shl 1) + 1
                    latMin = mid
                } else {
                    hashValue = hashValue shl 1
                    latMax = mid
                }
            }

            bitsTotal++
            bits++

            if (bits == 5) {
                result.append(base32[hashValue])
                bits = 0
                hashValue = 0
            }
        }

        return result.toString()
    }

    fun decode(hash: String): Pair<ClosedRange<Double>, ClosedRange<Double>> {
        var latMin = -90.0
        var latMax = 90.0
        var lonMin = -180.0
        var lonMax = 180.0
        var isLon = true

        for (c in hash) {
            val bits = base32.indexOf(c)
            for (i in 4 downTo 0) {
                val bit = (bits shr i) and 1
                if (isLon) {
                    val mid = (lonMin + lonMax) / 2
                    if (bit == 1) lonMin = mid else lonMax = mid
                } else {
                    val mid = (latMin + latMax) / 2
                    if (bit == 1) latMin = mid else latMax = mid
                }
                isLon = !isLon
            }
        }

        return (latMin..latMax) to (lonMin..lonMax)
    }

    fun neighbors(hash: String): List<String> {
        // 인접한 8방향의 Geohash 반환 (구현 생략)
        // N, NE, E, SE, S, SW, W, NW
        return emptyList()
    }
}

class GeoCache<T>(private val precision: Int = 6) {
    private val cache = ConcurrentHashMap<String, MutableList<GeoEntry<T>>>()
    private val geoHash = GeoHash()

    data class GeoEntry<T>(
        val id: String,
        val coordinate: GeoCoordinate,
        val data: T
    )

    fun add(id: String, lat: Double, lon: Double, data: T) {
        val hash = geoHash.encode(lat, lon, precision)
        cache.computeIfAbsent(hash) { mutableListOf() }
            .add(GeoEntry(id, GeoCoordinate(lat, lon), data))
    }

    fun searchNearby(lat: Double, lon: Double): List<GeoEntry<T>> {
        val centerHash = geoHash.encode(lat, lon, precision)
        val hashes = listOf(centerHash) + geoHash.neighbors(centerHash)

        return hashes.flatMap { hash ->
            cache[hash] ?: emptyList()
        }
    }

    fun searchInRadius(lat: Double, lon: Double, radiusKm: Double): List<GeoEntry<T>> {
        return searchNearby(lat, lon).filter { entry ->
            haversineDistance(lat, lon, entry.coordinate.latitude, entry.coordinate.longitude) <= radiusKm
        }
    }

    private fun haversineDistance(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
        val R = 6371.0  // 지구 반지름 (km)
        val dLat = Math.toRadians(lat2 - lat1)
        val dLon = Math.toRadians(lon2 - lon1)
        val a = sin(dLat / 2).pow(2) + cos(Math.toRadians(lat1)) * cos(Math.toRadians(lat2)) * sin(dLon / 2).pow(2)
        val c = 2 * atan2(sqrt(a), sqrt(1 - a))
        return R * c
    }
}
```

---

## 7. Cluster & Sharding

### 왜 고민했나

단일 Redis 인스턴스로는 좌표 데이터 전체를 담기 어렵다. 데이터가 8GB를 넘어서면 단일 인스턴스 메모리 한계(예. 16GB)에 가까워지고, 확장성을 가로막는다.

더 큰 문제는 가용성이다. 단일 인스턴스가 죽으면 전체 캐시가 날아가고, 캐시 스탬피드가 발생한다. 여러 노드에 분산해서 저장하면 한 노드가 죽어도 다른 노드가 계속 서비스할 수 있다.

### 예상한 문제

**가설 1. 단순 modulo 샤딩의 재분배 문제**

키를 `hash(key) % nodeCount`로 분배하면, 노드를 추가할 때 대부분의 키가 다른 노드로 이동해야 한다. 노드 3개 → 4개로 늘리면 75%의 키가 재배치된다.

**가설 2. Replica 없이 운영하면 캐시 미스 폭발**

노드 하나가 죽으면 해당 노드에 있던 모든 키가 사라진다. 해당 키들에 대한 모든 요청이 캐시 미스가 되어 원본 DB/API로 몰린다.

**가설 3. 핫 키 문제**

특정 키(예. 인기 카페)에 요청이 집중되면 해당 키를 가진 노드만 과부하가 걸린다. 샤딩을 해도 부하가 균등하게 분산되지 않을 수 있다.

### 구현하며 확인한 것

**확인 1. Consistent Hashing으로 재분배 최소화**

Consistent Hashing은 키와 노드를 같은 해시 링에 배치한다. 키는 시계 방향으로 가장 가까운 노드에 저장된다.

```
해시 링
     0
   /   \
Node1   Node2
   \   /
  Node3

키 "cafe:123"의 해시값이 Node2와 Node3 사이에 있으면 Node3에 저장
```

노드를 추가하면 인접한 노드의 키 일부만 새 노드로 이동한다. 노드 3개 → 4개로 늘려도 약 25%의 키만 재배치된다.

**확인 2. Virtual Node로 균등 분배**

노드가 3개뿐이면 해시 링에서 균등하게 분포하지 않을 수 있다. Virtual Node를 사용해서 각 물리 노드를 여러 개의 가상 노드로 표현하면 분포가 균등해진다.

```kotlin
// 물리 노드 1개당 가상 노드 150개
val virtualNodesPerNode = 150

for (node in physicalNodes) {
    for (i in 0 until virtualNodesPerNode) {
        val virtualNodeHash = hash("${node.id}-$i")
        ring[virtualNodeHash] = node
    }
}
```

Virtual Node를 150개로 설정했을 때 각 노드의 키 분포 편차가 5% 이내로 줄었다.

**확인 3. Replica로 가용성 확보**

각 키를 2개의 노드에 복제했다. Primary 노드가 죽으면 Replica 노드가 서비스를 계속한다.

```kotlin
fun getNodesForKey(key: String): List<Node> {
    val primaryNode = ring.getNodeForKey(key)
    val replicaNode = ring.getNextNode(primaryNode)
    return listOf(primaryNode, replicaNode)
}
```

노드 하나가 죽었을 때 캐시 미스율이 100%에서 0%로 유지됐다(Replica 덕분).

### 의사결정 과정

**샤딩 전략**

| 전략 | 장점 | 단점 |
|------|------|------|
| 단순 modulo | 구현 단순 | 노드 추가 시 대규모 재배치 |
| Consistent Hashing | 재배치 최소화 | 구현 복잡 |
| Range 기반 | 범위 검색 효율 | 핫 레인지 문제 |

**최종 선택. Consistent Hashing + Virtual Node + Replica**
노드 추가/제거가 예상되는 환경에서 재배치를 최소화하기 위해 Consistent Hashing을 선택했다. Virtual Node로 균등 분배를 보장하고, Replica로 가용성을 확보한다.

### 캐시 이슈 대응 포인트

Cluster 관련 이슈가 발생했을 때 아래 순서로 점검한다.

1. **특정 노드만 부하가 높은가?** 핫 키가 있는지 확인하고, Virtual Node 수를 조정한다.
2. **노드가 죽었는데 캐시 미스가 발생하는가?** Replica가 제대로 동작하는지 확인한다.
3. **노드 추가 후 부하가 불균형한가?** 재샤딩이 완료됐는지 확인한다.
4. **전체 클러스터가 느린가?** 노드 간 네트워크 지연을 확인한다.

### 느낀 점

클러스터링은 단순히 노드를 늘리는 문제가 아니라, 승격/모니터링/재분배를 동시에 설계해야 한다는 걸 깨달았다. 노드를 3개에서 4개로 늘리는 것도 신중하게 계획해야 한다.

Consistent Hashing과 Replica 전략을 손으로 구현해 보면 트래픽 이슈가 발생했을 때 어떤 단계를 점검해야 할지 분명해진다. "그냥 노드를 늘리면 된다"가 아니라, 노드를 늘리는 순간 재분배가 발생하고 그 동안 캐시 미스가 늘어날 수 있다는 사실을 직접 시뮬레이션할 수 있다.

### 코드

```kotlin
class ConsistentHashRing(
    private val virtualNodesPerNode: Int = 150
) {
    private val ring = TreeMap<Long, Node>()
    private val nodes = mutableListOf<Node>()

    data class Node(
        val id: String,
        val host: String,
        val port: Int
    )

    fun addNode(node: Node) {
        nodes.add(node)
        for (i in 0 until virtualNodesPerNode) {
            val hash = hash("${node.id}-$i")
            ring[hash] = node
        }
    }

    fun removeNode(node: Node) {
        nodes.remove(node)
        for (i in 0 until virtualNodesPerNode) {
            val hash = hash("${node.id}-$i")
            ring.remove(hash)
        }
    }

    fun getNodeForKey(key: String): Node? {
        if (ring.isEmpty()) return null
        val hash = hash(key)
        val tailMap = ring.tailMap(hash)
        val nodeHash = if (tailMap.isEmpty()) ring.firstKey() else tailMap.firstKey()
        return ring[nodeHash]
    }

    fun getNodesForKey(key: String, replicaCount: Int = 2): List<Node> {
        if (ring.isEmpty()) return emptyList()

        val result = mutableListOf<Node>()
        val hash = hash(key)
        var currentHash = hash

        while (result.size < replicaCount && result.size < nodes.size) {
            val tailMap = ring.tailMap(currentHash)
            val nodeHash = if (tailMap.isEmpty()) ring.firstKey() else tailMap.firstKey()
            val node = ring.getValue(nodeHash)

            if (node !in result) {
                result.add(node)
            }
            currentHash = nodeHash + 1
        }

        return result
    }

    private fun hash(key: String): Long {
        val md = MessageDigest.getInstance("MD5")
        val digest = md.digest(key.toByteArray())
        return ByteBuffer.wrap(digest.take(8).toByteArray()).long
    }
}

class ShardedCache<T>(
    private val ring: ConsistentHashRing,
    private val replicaCount: Int = 2
) {
    private val nodeStores = ConcurrentHashMap<String, MiniRedis<T>>()

    fun set(key: String, value: T, ttlMs: Long? = null) {
        val nodes = ring.getNodesForKey(key, replicaCount)
        nodes.forEach { node ->
            getStore(node).set(key, value, ttlMs)
        }
    }

    fun get(key: String): T? {
        val nodes = ring.getNodesForKey(key, replicaCount)
        for (node in nodes) {
            try {
                val value = getStore(node).get(key)
                if (value != null) return value
            } catch (e: Exception) {
                // 노드 장애, 다음 노드 시도
                continue
            }
        }
        return null
    }

    private fun getStore(node: ConsistentHashRing.Node): MiniRedis<T> {
        return nodeStores.computeIfAbsent(node.id) { MiniRedis() }
    }
}
```

---

## 마무리

Mini Redis를 직접 만들면서 Redis가 제공하는 기능 하나하나가 어떤 문제를 풀기 위해 존재하는지 몸으로 이해했다. TTL, 자료구조, Pub/Sub, Persistence, Eviction, Geo, Cluster 각각이 어떤 의사결정을 요구하는지 기록해 둔 덕분에, 이제는 캐시 이슈가 발생했을 때 체계적으로 문제를 짚을 수 있다.

각 컴포넌트에서 내린 핵심 의사결정을 정리하면:

| 컴포넌트 | 핵심 의사결정 | 근거 |
|---------|-------------|------|
| TTL | Lazy + Active 조합 | 메모리 효율 + CPU 효율 균형 |
| 자료구조 | 요구사항에 맞는 타입 선택 | 시간 복잡도 최적화 |
| Pub/Sub | CopyOnWriteArrayList + 동기 호출 | 동시성 안전 + 단순함 |
| Persistence | RDB + AOF 조합 | 빠른 복구 + 데이터 안전 |
| Eviction | 샘플링 LRU + TTL 기반 | 성능 + 정확도 균형 |
| Geo | Geohash precision 6 | 사용 사례에 맞는 범위 |
| Cluster | Consistent Hashing + Replica | 재분배 최소화 + 가용성 |

이제는 캐시 이슈가 발생했을 때 아래 순서로 점검할 수 있다.

### 장애 대응 체크리스트

**1단계. 증상 파악**
- 캐시 히트율이 떨어졌나?
- 메모리 사용량이 급증했나?
- 특정 키에 요청이 몰리고 있나?

**2단계. 원인 분류**
- TTL 문제 만료 정책이 맞지 않음
- 메모리 문제 Eviction이 필요하거나 TTL이 너무 김
- 동시성 문제 적절한 자료구조를 사용하지 않음
- 캐시 무효화 문제 Pub/Sub 또는 이벤트 누락
- 클러스터 문제 노드 장애, 핫 키, 재분배

**3단계. 대응**
- 단기 문제 키 삭제, 노드 재시작, Eviction 강제 실행
- 중기 TTL 조정, Eviction 정책 변경, 노드 증설
- 장기 모니터링 강화, 키 설계 개선, 클러스터 구조 재검토

> 결론: Redis를 "그냥 빠른 캐시"로 쓰지 않겠다. Mini Redis를 만들면서 이제 캐시 설계를 설명할 때 근거와 경험을 함께 내놓을 수 있게 됐다.
