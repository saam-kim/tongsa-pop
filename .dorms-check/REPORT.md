# dorms-check 점검 리포트

- 앱: ���POP
- 주소: https://tongsa-pop.vercel.app 
- 스택: ���� HTML
- 점검 트랙: security

> 이 리포트는 dorms-check(코치)의 자체 점검 결과입니다. 최종 인증마크는 도름스 서버가 스스로 다시 검증해 발급하며, 이 리포트의 통과가 마크를 보장하지 않습니다.

## 보안 검토
- 점수: 88/100 (B+)
- 마크 자격(critical/high 0): 충족

### 통과 항목(증빙)
- [v] 클라이언트 시크릿 노출 — 클라 시크릿 노출 미검출

### 아직 고쳐야 할 항목
#### [critical] 하드코딩 시크릿
- 무엇: 코드 안에 API 키·비밀번호가 직접 적혀 있어요. 코드가 새면 키도 같이 새요.
- 지금 상태: 하드코딩된 것으로 보이는 시크릿 1건
- AI에게 이렇게 시켜주세요: `코드에 박힌 키·토큰을 환경변수(.env, 서버 전용)로 옮기고, 노출됐던 키는 즉시 재발급(rotate)해줘.`

### 참고(검토 권장, 마크 게이트 아님)
- 헤더 설정 위치: 헤더 설정 발견: content-security-policy, strict-transport-security, x-frame-options, x-content-type-options, referrer-policy, permissions-policy
- 위험 코드 패턴(검토 후보): 검토가 필요한 위험 패턴 15건(문맥 확인 필요)

