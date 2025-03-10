# AI_Web_Translator

### **💬 Git Commit Convention**

| **타입**       | **설명**                              | **예시**                                |
|------------|-----------------------------------|--------------------------------------|
| feat   | 새로운 기능 추가                  | `feat: 사용자 로그인 기능 구현`      |
| **fix**    | 버그 수정                         | `fix: 비밀번호 검증 로직 오류 수정`  |
| **refactor**| 코드 리팩토링 (기능 변경 없음)   | `refactor: 회원가입 모듈 리팩토링`   |
| **docs**   | 문서 추가/수정 (코드 변경 없음)   | `docs: README 파일 업데이트`        |
| **style**  | 코드 스타일 변경 (포맷팅, 공백 등)| `style: 코드 정렬 및 주석 수정`      |
| **chore**  | 빌드, 패키지, 설정 파일 수정      | `chore: ESLint 설정 파일 업데이트`   |
| **test**   | 테스트 코드 추가/수정             | `test: 로그인 유닛 테스트 추가`      |
| **perf**   | 성능 개선                         | `perf: 이미지 로드 속도 최적화`      |
| **build**  | 빌드 시스템, 의존성 패키지 수정   | `build: axios 버전 업데이트`         |
| **ci**     | CI/CD 구성 수정                   | `ci: GitHub Actions 배포 스크립트 수정`|
| **init**   | 초기 프로젝트 세팅               | `init: 프로젝트 초기 설정`           |
| **wip**    | 작업 진행 중 (임시 커밋)          | `wip: 회원가입 화면 구현 중`        |
| **revert** | 이전 커밋 되돌리기                | `revert: 로그인 기능 롤백 (커밋 해시)`|
| **security**| 보안 관련 수정                   | `security: JWT 토큰 암호화 강화`     |
| **release**| 배포 버전 릴리즈                  | `release: v1.0.0 배포`              |




1. body를 가져온다.
2. gemini가 body를 읽고 글의 구조와 맥락을 파악한다.
3. 원본 body의 영문 텍스트들을 글의 구조와 맥락에 맞게 한국어 텍스트로 변환하여 저장해둔다.
4. 저장해둔 한국어 텍스트들을 영문 텍스트들의 위치에 맞게 바꿔준다.

개선 방식
1. HTML 구조를 유지한 채 텍스트만 추출
    - 단순히 body.innerText를 가져오면 HTML 태그가 사라져서 번역된 문장을 다시 삽입할 때 문제가 생길 수 있어.
    - TreeWalker를 사용하여 HTML 태그를 유지하면서 텍스트만 추출하는 방식이 더 안정적이야.

2. 영문 문장을 단락별로 나누어 번역
    - 한 번에 모든 텍스트를 API에 보내면 구조가 흐트러질 가능성이 있음.
    - 각 문장을 단락별로 분리해서 API 요청을 보내고, 위치 정보를 저장한 후 다시 삽입하는 방식이 더 좋음.

3. HTML 노드별로 원본과 번역본을 매칭
    - HTML에서 textContent를 사용하면 DOM 구조가 손상될 수 있으니, innerText가 아닌 노드별 매칭을 사용해서 번역된 내용을 삽입하는 것이 더 자연스러움.

개선된 비즈니스 로직
1. body를 가져와서 HTML 태그는 유지한 채 텍스트만 추출
2. Gemini가 본문을 읽고 글의 구조와 맥락을 분석
3. 영문 문장을 단락별로 번역하고, 원본과 번역된 내용을 매칭
4. 원본 HTML에서 영문 텍스트의 위치를 유지한 채 번역된 텍스트로 교체
5. 원문 내용의 통화, 단위들은 번역하는 국가의 통화, 단위로 변경.

문제점 :
1. 텍스트 처리 시간 문제: 번역 작업이 길어지는 주된 이유는 여러 가지가 있을 수 있습니다:

 -  API 호출 지연: 번역을 위해 Gemini API에 대한 요청을 보내고 응답을 기다리는 동안 시간이 걸립니다. 
    특히 긴 텍스트나 페이지에서 많은 내용을 번역할 경우, 요청이 지연되거나 API에서 처리하는 데 시간이 걸릴 수 있습니다.
 -  DOM 탐색 및 텍스트 처리: getTextNodes 및 groupTextNodes 함수에서 모든 텍스트 노드를 DOM에서 찾아 
    그룹화하는 과정 자체가 시간이 걸릴 수 있습니다. 페이지가 크거나 많은 텍스트가 있을 경우 성능에 영향을 미칩니다.

    해결 방법:

        - 병렬 처리: 여러 텍스트를 동시에 번역하는 병렬 처리를 고려해 볼 수 있습니다. 예를 들어, 각 문단별로 번역 요청을 분산시켜 API 호출 시간을 분산시키는 방법입니다.
        - 로컬 캐싱: 이미 번역된 텍스트를 로컬에서 저장하고 재사용할 수 있다면, 불필요한 API 호출을 줄일 수 있습니다.

2. 보이지 않는 텍스트나 네비게이션, 사이드바 텍스트 미번역 문제: 이 문제는 getTextNodes가 document.body의 텍스트만 추출하기 때문에 발생할 수 있습니다. 화면에 표시되지 않거나, div, span 같은 요소에 포함된 텍스트는 제외될 수 있습니다.

    해결 방법:

        - getTextNodes 함수에서 document.body뿐만 아니라 document의 모든 요소를 탐색하도록 수정하여, 화면에 보이지 않는 텍스트도 포함시켜야 합니다.
        - display: none이나 visibility: hidden 처리가 되어 있는 요소들의 텍스트도 포함하려면 해당 스타일을 고려하여 acceptNode 조건을 추가하는 방법이 필요합니다.

3. 번역된 텍스트가 제자리를 찾지 못하는 문제: 번역된 텍스트가 제자리를 찾지 못하고 섞이는 문제는 원래 텍스트와 번역된 텍스트가 연결된 위치를 유지하지 않기 때문입니다. 기존 텍스트의 구조와 위치 정보를 기억하고 있어야 합니다.

    해결 방법:

        - DOM 구조 보존: getTextNodes 함수에서 각 텍스트 노드를 처리할 때, 그 텍스트가 속한 부모 요소와 위치 정보를 함께 기록해두면, 번역된 텍스트를 원래 위치에 적용할 수 있습니다. 예를 들어, 각 텍스트 그룹에 parentNode와 해당 위치 정보를 포함시키는 방법입니다.
        - 텍스트 위치 맵핑: applyTranslatedText 함수에서 번역된 텍스트를 각 노드의 위치에 맞게 배치하기 위해, 텍스트 노드를 위치별로 맵핑하여 정확히 일치시킬 수 있도록 해야 합니다.


추가적인 개선방향

전체 DOM 스냅샷 저장 (document_all)
→ document.all을 순회하면서 텍스트 노드만 싹 모으고, HTML 태그 구조 그대로 보존

텍스트 매핑 (Map or Dictionary)
→ Map을 사용해 원본 텍스트와 번역된 텍스트 매핑
→ key: node.nodeValue, value: translatedText

텍스트 노드 ID 부여 (고유 식별자)
→ 각 텍스트 노드에 data-translate-id 속성을 부여해 위치 추적
→ 이렇게 하면 길이가 다른 번역 결과도 정확하게 제자리에 들어갈 수 있음

Gemini API 호출 (배치 처리)
→ 텍스트 덩어리들을 적당한 크기로 나눠서 한 번에 번역 (API 호출 최적화)
→ 프롬프트에 “단위 변환” 요청 포함 (원화, cm, 평으로 자동 변환)

정확한 위치에 적용
→ 번역된 텍스트가 들어올 때, data-translate-id 기반으로 해당 노드에 정확히 삽입



// bm
기본 -> 맛보기 텍스트만
1단계 -> 텍스트 (5달러)
2단계 -> 텍스트 + 차트 내 텍스트 변환 + 이미지 내 텍스트 변환 (8.5달러)