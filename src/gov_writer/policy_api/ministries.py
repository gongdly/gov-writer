"""부처 명칭 별칭 매핑.

정식 명칭과 축약어를 상호 매핑합니다.
사용자가 "행안부"라고 입력해도 "행정안전부"로 정규화되어야 합니다.

주의: 정책브리핑 API 실물 응답에서 부처명이 어떤 형식으로 오는지 확인 후
(블록 1) 실제 API 응답 문자열과 일치하도록 정식 명칭을 조정해야 할 수 있습니다.
"""


# 정식명칭 → [축약어, 별칭, ...]
# 2026.4 기준 중앙행정기관 (18부 4처 19청 기준 주요 부처)
MINISTRY_ALIASES: dict[str, list[str]] = {
    "기획재정부": ["기재부", "기획재정"],
    "교육부": ["교육"],
    "과학기술정보통신부": ["과기정통부", "과기부", "과학기술정보통신"],
    "외교부": ["외교"],
    "통일부": ["통일"],
    "법무부": ["법무"],
    "국방부": ["국방"],
    "행정안전부": ["행안부", "행정안전"],
    "국가보훈부": ["보훈부"],
    "문화체육관광부": ["문체부", "문화체육관광"],
    "농림축산식품부": ["농식품부", "농림축산식품"],
    "산업통상자원부": ["산자부", "산업통상자원"],
    "보건복지부": ["복지부", "보건복지"],
    "환경부": ["환경"],
    "고용노동부": ["노동부", "고용노동"],
    "여성가족부": ["여가부", "여성가족"],
    "국토교통부": ["국토부", "국토교통"],
    "해양수산부": ["해수부", "해양수산"],
    "중소벤처기업부": ["중기부", "중소벤처기업"],
    # 주요 처·청 (보도자료 발행 빈도 높은 곳 위주, 블록 1에서 확장 예정)
    "국무조정실": ["총리실"],
    "인사혁신처": ["인사처"],
    "법제처": [],
    "식품의약품안전처": ["식약처"],
    "국세청": [],
    "관세청": [],
    "조달청": [],
    "통계청": [],
    "검찰청": [],
    "병무청": [],
    "방위사업청": [],
    "경찰청": [],
    "소방청": [],
    "문화재청": [],
    "농촌진흥청": [],
    "산림청": [],
    "특허청": [],
    "기상청": [],
    "행정중심복합도시건설청": ["행복청"],
}


def build_reverse_index() -> dict[str, str]:
    """축약어·정식명칭 → 정식명칭 매핑 사전 생성."""
    index: dict[str, str] = {}
    for official, aliases in MINISTRY_ALIASES.items():
        index[official] = official
        for alias in aliases:
            index[alias] = official
    return index


# 모듈 로드 시 한 번만 생성
_REVERSE_INDEX = build_reverse_index()


def normalize_ministry_name(name: str) -> str | None:
    """입력된 부처명을 정식 명칭으로 정규화.

    Args:
        name: 사용자 입력 부처명 (정식명칭 또는 축약어)

    Returns:
        정식 명칭. 매칭 실패 시 None.

    Examples:
        >>> normalize_ministry_name("행안부")
        '행정안전부'
        >>> normalize_ministry_name("행정안전부")
        '행정안전부'
        >>> normalize_ministry_name("없는부처")
        >>> # None 반환
    """
    if not name:
        return None
    trimmed = name.strip()
    return _REVERSE_INDEX.get(trimmed)


def list_official_ministries() -> list[str]:
    """정식 명칭 목록 반환 (검색·매칭 실패 시 제안용)."""
    return list(MINISTRY_ALIASES.keys())
