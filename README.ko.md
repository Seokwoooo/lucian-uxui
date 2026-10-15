# Lucian UX/UI 에이전트 스킬

Claude Code나 Codex 같은 코딩 에이전트 안에서 [Lucian UX/UI Prompt](https://lucianlabs.dev/uxui-prompt/) 요소로 사이트와 컴포넌트를 만드는 스킬입니다. 원하는 페이지를 말하면서 lucian-uxui를 쓰라고 하면, 에이전트가 라이브러리에서 맞는 요소를 찾아 받아온 뒤 프로젝트의 프레임워크와 테마에 맞게 옮겨 넣습니다.

모든 요소는 외부 라이브러리 없는 HTML·CSS·JS이고, 라이트·다크 테마와 마우스·터치·키보드 조작, 동작 줄이기 설정을 지원합니다. 지금은 400개(인터페이스 200개, 웹사이트 섹션·애니메이션 200개)이고 계속 늘어납니다. 새 요소는 스킬을 업데이트하지 않아도 바로 쓸 수 있습니다.

[English](README.md)

## 설치

Agent Skills를 지원하는 에이전트(Claude Code, Codex, Cursor 등):

```sh
npx skills add Seokwoooo/lucian-uxui
```

Claude Code 플러그인으로 설치:

```text
/plugin marketplace add Seokwoooo/lucian-uxui
/plugin install lucian-uxui@lucian-uxui
```

직접 설치하려면 `skills/lucian-uxui` 폴더를 Claude Code는 `~/.claude/skills/`에, Codex는 `~/.agents/skills/`에 복사하세요. 한 프로젝트에서만 쓰려면 `.claude/skills/`나 `.agents/skills/`에 넣으면 됩니다.

**필요한 것:** Node.js 18 이상, `lucianlabs.dev` 접속. 접속이 안 되면 `raw.githubusercontent.com`에서 받아옵니다. Node가 없으면 에이전트가 curl로 받아옵니다.

## 사용법

만들 화면을 말하고 스킬 이름을 넣으세요.

```text
커피 구독 서비스 랜딩 페이지 만들어줘. 히어로, 월간/연간 요금제, 자주 묻는 질문, 뉴스레터 가입이 필요해.
lucian-uxui 스킬을 써서 여기 있는 요소를 우선적으로 써줘.
```

```text
lucian-uxui로 로그인 화면 추가해줘. 기존 로그인 처리 코드는 그대로 둬.
```

[갤러리](https://lucianlabs.dev/uxui-prompt/)에서 고른 요소를 쓰고 싶다면 번호나 링크를 알려 주세요.

```text
lucian-uxui 스킬로 056번 요소를 요금제 섹션에 넣어줘.
```

직접 부를 수도 있습니다. Claude Code에서는 `/lucian-uxui …`(플러그인으로 설치했다면 `/lucian-uxui:lucian-uxui …`), Codex에서는 `$lucian-uxui …`로 부르세요.

에이전트는 이렇게 진행합니다.

1. 프로젝트의 프레임워크, 스타일 방식, 테마 구성, 사이트 언어를 확인합니다.
2. 페이지를 UI 부품 단위로 나누고 부품마다 라이브러리를 검색합니다.
3. 고른 요소와 테마 토큰만 받아옵니다.
4. React/Next, Vue, Svelte, Astro, 순수 HTML 중 프로젝트에 맞게 옮기고, `--ux-*` 색 토큰을 프로젝트 테마에 연결하고, 요소마다 붙은 라이선스 주석 한 줄을 남깁니다.
5. 쓴 요소 목록을 데모 링크와 함께 알려 줍니다.

Lucian은 버튼, 토글, 입력, 메뉴, 카드, 로그인 폼, 알림, 로딩, 빈 화면, 차트, 앱 도구 같은 인터랙션 부품을 맡고, 페이지 레이아웃은 에이전트가 그 둘레에 짭니다.

## 언어

요소는 영어(기본)와 한국어로 제공됩니다. 에이전트는 사이트 문구의 언어를 따르고, 한국어 사이트면 한국어 요소를 씁니다. 다른 언어로 받고 싶으면 요청할 때 말하면 됩니다.

## 동작 방식

스킬은 `SKILL.md`, 이식 가이드, 의존성 없는 작은 CLI([`scripts/lucian-uxui.mjs`](skills/lucian-uxui/scripts/lucian-uxui.mjs))로 이루어져 있고, 에이전트가 이 CLI를 실행합니다.

| 명령 | 하는 일 |
|---|---|
| `search pricing toggle` | UI 부품 하나에 맞는 요소 찾기 (영어·한국어 검색어) |
| `list` / `list --category buttons` | 분류 목록, 또는 한 분류의 전체 요소 |
| `get 056 062` | 고른 요소의 코드 |
| `tokens` | `--ux-*` 라이트·다크 토큰과 공통 기본 규칙 |

데이터는 `https://lucianlabs.dev/uxui-prompt/api/v1/`에 있는 정적 파일이고, CDN으로 제공됩니다. 같은 파일을 [Seokwoooo/lucian-uxui-prompt](https://github.com/Seokwoooo/lucian-uxui-prompt/tree/main/api/v1)에도 둡니다.

| 파일 | 내용 |
|---|---|
| `index.json` | 버전, 요소 수, 분류 |
| `{en,ko}/catalog.tsv` | 요소마다 한 줄: 번호, 분류, 제목, 태그, 형태, 해시, 요약 |
| `{en,ko}/e/{id}.txt` | 요소 하나: 라이선스 줄, 설명, `<style>`, 마크업, `<script>` |
| `{en,ko}/tokens.css` | 테마 토큰과 `.ux` 기본 규칙 |

- 목록은 6시간 동안 캐시해 두고, 그 뒤에는 ETag로 바뀌었는지만 확인합니다. 요소는 내용 해시로 캐시하기 때문에 같은 요소를 다시 쓸 때는 거의 내려받지 않습니다. 네트워크가 끊겨도 캐시로 동작합니다.
- CLI는 이 파일들을 내려받기만 하고, 프로젝트 정보는 보내지 않습니다. 요청에는 `lucian-uxui-skill/<버전>` User-Agent만 붙습니다.

| 환경 변수 | 기본값 |
|---|---|
| `LUCIAN_UXUI_CACHE` | `~/.cache/lucian-uxui` (쓸 수 없으면 임시 폴더) |
| `LUCIAN_UXUI_TTL` | `21600`초 (목록을 다시 확인하기까지의 시간) |
| `LUCIAN_UXUI_BASE` | 대신 쓸 데이터 출처, 쉼표로 여러 개 (예: 로컬 사본) |

## 라이선스

[MIT](LICENSE) © 2026 Seokwoooo. 요소도 MIT 라이선스입니다. 옮긴 요소 맨 위의 주석 한 줄은 남겨 주세요.
