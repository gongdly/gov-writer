/**
 * 말씀자료 데이터 정의 (옛 speech-writer 그대로 이식).
 *
 * - 8가지 행사 유형
 * - 10개 청중 옵션
 * - 5단계 분량 + 사용자 지정
 * - 6개 발화자 직급
 */

export type EventTypeKey =
  | 'chuksa' | 'gyenyeomsa' | 'sinnyeonsa' | 'gyeoryeosa'
  | 'hwanyeongsa' | 'gaehoesa' | 'iimsa' | 'seomyeonchuksa'

export const EVENT_TYPES: { key: EventTypeKey; label: string; description: string }[] = [
  { key: 'chuksa', label: '축사', description: '외부 행사 격려·축하' },
  { key: 'gyenyeomsa', label: '기념사', description: '기념일·기념행사 격식' },
  { key: 'sinnyeonsa', label: '신년사', description: '새해 첫 인사' },
  { key: 'gyeoryeosa', label: '격려사', description: '내부 직원·관계자 격려' },
  { key: 'hwanyeongsa', label: '환영사', description: '외부 손님 환영' },
  { key: 'gaehoesa', label: '개회사', description: '행사 개시 선언' },
  { key: 'iimsa', label: '이임사', description: '재임 종료 발화' },
  { key: 'seomyeonchuksa', label: '서면축사', description: '인쇄·배포용' },
]

export type AudienceKey =
  | 'public_servant' | 'citizen' | 'expert' | 'student' | 'honoree'
  | 'foreign_guest' | 'industry' | 'media' | 'internal_staff' | 'local_resident'

export const AUDIENCES: { key: AudienceKey; label: string }[] = [
  { key: 'public_servant', label: '공무원' },
  { key: 'citizen', label: '일반 시민' },
  { key: 'expert', label: '전문가·학계' },
  { key: 'student', label: '학생' },
  { key: 'honoree', label: '유공자' },
  { key: 'foreign_guest', label: '외빈' },
  { key: 'industry', label: '산업계' },
  { key: 'media', label: '언론' },
  { key: 'internal_staff', label: '내부 직원' },
  { key: 'local_resident', label: '지역 주민' },
]

export type LengthOptionKey =
  | 'very_short' | 'short' | 'standard' | 'long' | 'very_long' | 'custom'

export const LENGTH_OPTIONS: {
  key: LengthOptionKey
  label: string
  targetChars: number
  spokenMinutes: string
  useCase: string
}[] = [
  { key: 'very_short', label: '매우 짧게', targetChars: 600, spokenMinutes: '2분 이내', useCase: '간단 인사·환영사' },
  { key: 'short', label: '짧게', targetChars: 900, spokenMinutes: '3분', useCase: '영상 축사·짧은 격려사' },
  { key: 'standard', label: '표준', targetChars: 1500, spokenMinutes: '5분', useCase: '일반 축사·기념사' },
  { key: 'long', label: '길게', targetChars: 2400, spokenMinutes: '8분', useCase: '격식 행사·취임사' },
  { key: 'very_long', label: '매우 길게', targetChars: 3500, spokenMinutes: '12분', useCase: '신년사·중요 기념사' },
  { key: 'custom', label: '사용자 지정', targetChars: 0, spokenMinutes: '자동 환산', useCase: '300~5,000자' },
]

export type SpeakerRoleKey =
  | 'minister' | 'vice_minister' | 'director_general' | 'director'
  | 'head_of_org' | 'custom'

export const SPEAKER_ROLES: { key: SpeakerRoleKey; label: string }[] = [
  { key: 'minister', label: '장관' },
  { key: 'vice_minister', label: '차관' },
  { key: 'director_general', label: '실장·국장' },
  { key: 'director', label: '과장·팀장' },
  { key: 'head_of_org', label: '기관장' },
  { key: 'custom', label: '직접 입력' },
]

export const SPEAKER_ROLE_LABEL: Record<SpeakerRoleKey, string> = {
  minister: '장관',
  vice_minister: '차관',
  director_general: '실장·국장',
  director: '과장·팀장',
  head_of_org: '기관장',
  custom: '직접 입력',
}
