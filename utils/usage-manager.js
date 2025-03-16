// utils/usage-manager.js - 최적화된 버전
const UsageManager = (function() {
  'use strict';
  
  // 초기화 플래그 확인
  if (window.usageManagerInitialized) {
    console.log("[번역 익스텐션] UsageManager 이미 초기화됨");
    return window.UsageManager;
  }
  
  // 초기화 플래그 설정
  window.usageManagerInitialized = true;

  // 회원 등급별 월간 토큰 한도
  const SUBSCRIPTION_LIMITS = {
    FREE: 15000,   // 무료 회원: 약 15,000 토큰 (약 30페이지)
    BASIC: 100000  // 기본 회원($5): 약 100,000 토큰 (약 200페이지)
  };

  /**
   * 현재 사용자 등급 가져오기
   * @returns {Promise<string>} - 구독 등급 (FREE, BASIC)
   */
  async function getCurrentSubscription() {
    try {
      return new Promise((resolve) => {
        try {
          chrome.storage.sync.get('subscription', (data) => {
            try {
              // 기본값은 무료 회원
              const subscription = data && data.subscription ? data.subscription : 'FREE';
              resolve(subscription);
            } catch (error) {
              console.error("[번역 익스텐션] 구독 정보 처리 오류:", error);
              resolve('FREE'); // 오류 시 기본값 반환
            }
          });
        } catch (chromeError) {
          console.error("[번역 익스텐션] Chrome 스토리지 접근 오류:", chromeError);
          resolve('FREE'); // 오류 시 기본값 반환
        }
      });
    } catch (error) {
      console.error("[번역 익스텐션] 구독 정보 가져오기 오류:", error);
      return 'FREE'; // 오류 시 기본값 반환
    }
  }
  
  /**
   * 현재 월 구하기 (yyyy-mm 형식)
   * @returns {string} - 현재 월 (yyyy-mm)
   */
  function getCurrentMonth() {
    try {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    } catch (error) {
      console.error("[번역 익스텐션] 현재 월 계산 오류:", error);
      // 오류 시 현재 날짜의 문자열 반환
      const now = new Date();
      return `${now.getFullYear()}-01`;
    }
  }
  
  /**
   * 현재 월 사용량 가져오기
   * @returns {Promise<Object>} - 사용량 객체
   */
  async function getCurrentUsage() {
    try {
      return new Promise((resolve) => {
        try {
          chrome.storage.sync.get('usage', (data) => {
            try {
              // 사용량 데이터가 없으면 초기화
              if (!data || !data.usage || !data.usage.month || data.usage.month !== getCurrentMonth()) {
                const newUsage = {
                  month: getCurrentMonth(),
                  tokensUsed: 0,
                  lastReset: new Date().toISOString()
                };
                
                // storage 접근 오류 방지
                try {
                  chrome.storage.sync.set({ usage: newUsage }, () => {
                    if (chrome.runtime.lastError) {
                      console.warn("[번역 익스텐션] 사용량 저장 오류:", chrome.runtime.lastError);
                    }
                  });
                } catch (storageError) {
                  console.error("[번역 익스텐션] 스토리지 저장 오류:", storageError);
                }
                
                resolve(newUsage);
              } else {
                resolve(data.usage);
              }
            } catch (dataError) {
              console.error("[번역 익스텐션] 사용량 데이터 처리 오류:", dataError);
              // 오류 시 기본값 반환
              resolve({
                month: getCurrentMonth(),
                tokensUsed: 0,
                lastReset: new Date().toISOString()
              });
            }
          });
        } catch (chromeError) {
          console.error("[번역 익스텐션] 스토리지 접근 오류:", chromeError);
          // 오류 시 기본값 반환
          resolve({
            month: getCurrentMonth(),
            tokensUsed: 0,
            lastReset: new Date().toISOString()
          });
        }
      });
    } catch (error) {
      console.error("[번역 익스텐션] 사용량 가져오기 오류:", error);
      // 오류 시 기본값 반환
      return {
        month: getCurrentMonth(),
        tokensUsed: 0,
        lastReset: new Date().toISOString()
      };
    }
  }
  
  /**
   * 토큰 사용량 기록
   * @param {number} tokens - 사용한 토큰 수
   * @returns {Promise<Object>} - 업데이트된 사용량 객체
   */
  async function recordUsage(tokens) {
    try {
      // 토큰 수가 숫자가 아니면 기본값 사용
      const tokenCount = typeof tokens === 'number' && !isNaN(tokens) ? tokens : 0;
      if (tokenCount <= 0) {
        console.warn("[번역 익스텐션] 유효하지 않은 토큰 수:", tokens);
        return await getCurrentUsage(); // 기존 사용량 반환
      }
      
      const usage = await getCurrentUsage();
      const newTokensUsed = usage.tokensUsed + tokenCount;
      
      // 새 사용량으로 업데이트
      const newUsage = {
        ...usage,
        tokensUsed: newTokensUsed
      };
      
      return new Promise((resolve) => {
        try {
          chrome.storage.sync.set({ usage: newUsage }, () => {
            // 크롬 런타임 에러 체크
            if (chrome.runtime.lastError) {
              console.warn("[번역 익스텐션] 사용량 저장 오류:", chrome.runtime.lastError);
            }
            
            // 이벤트 발생 (사용량 업데이트)
            try {
              window.dispatchEvent(new CustomEvent('usage:updated', {
                detail: { usage: newUsage }
              }));
            } catch (eventError) {
              console.error("[번역 익스텐션] 이벤트 발생 오류:", eventError);
            }
            
            resolve(newUsage);
          });
        } catch (storageError) {
          console.error("[번역 익스텐션] 스토리지 저장 오류:", storageError);
          resolve(usage); // 오류 시 기존 사용량 반환
        }
      });
    } catch (error) {
      console.error("[번역 익스텐션] 사용량 기록 오류:", error);
      // 오류 발생 시 기본 사용량 객체 반환
      return {
        month: getCurrentMonth(),
        tokensUsed: 0,
        lastReset: new Date().toISOString()
      };
    }
  }
  
  /**
   * 번역 가능 여부 확인
   * @param {number} estimatedTokens - 예상 토큰 수
   * @returns {Promise<boolean>} - 번역 가능 여부
   */
  async function canTranslate(estimatedTokens) {
    try {
      // 토큰 수가 숫자가 아니면 기본값 사용
      const tokenCount = typeof estimatedTokens === 'number' && !isNaN(estimatedTokens) ? estimatedTokens : 0;
      
      const subscription = await getCurrentSubscription();
      const limit = SUBSCRIPTION_LIMITS[subscription] || SUBSCRIPTION_LIMITS.FREE;
      
      const usage = await getCurrentUsage();
      
      // 현재 사용량 + 예상 토큰 <= 한도
      const isWithinLimit = (usage.tokensUsed + tokenCount) <= limit;
      
      // 한도 초과 시 이벤트 발생
      if (!isWithinLimit) {
        try {
          window.dispatchEvent(new CustomEvent('usage:limit-exceeded', {
            detail: { 
              required: tokenCount,
              available: Math.max(0, limit - usage.tokensUsed)
            }
          }));
        } catch (eventError) {
          console.error("[번역 익스텐션] 이벤트 발생 오류:", eventError);
        }
      }
      
      return isWithinLimit;
    } catch (error) {
      console.error("[번역 익스텐션] 번역 가능 여부 확인 오류:", error);
      return true; // 오류 시 기본적으로 번역 허용
    }
  }
  
  /**
   * 사용량 통계 가져오기
   * @returns {Promise<Object>} - 사용량 통계 객체
   */
  async function getUsageStats() {
    try {
      const subscription = await getCurrentSubscription();
      const usage = await getCurrentUsage();
      const limit = SUBSCRIPTION_LIMITS[subscription] || SUBSCRIPTION_LIMITS.FREE;
      
      // 토큰 사용량이 숫자가 아니면 0으로 간주
      const tokensUsed = typeof usage.tokensUsed === 'number' && !isNaN(usage.tokensUsed) ? 
        usage.tokensUsed : 0;
      
      const stats = {
        subscription,
        tokensUsed,
        limit: limit,
        remaining: Math.max(0, limit - tokensUsed),
        percentage: Math.min(100, Math.round((tokensUsed / limit) * 100)),
        lastReset: usage.lastReset || new Date().toISOString()
      };
      
      // 이벤트 발생 (사용량 통계 준비됨)
      try {
        window.dispatchEvent(new CustomEvent('usage:stats-ready', {
          detail: { stats }
        }));
      } catch (eventError) {
        console.error("[번역 익스텐션] 이벤트 발생 오류:", eventError);
      }
      
      return stats;
    } catch (error) {
      console.error("[번역 익스텐션] 사용량 통계 가져오기 오류:", error);
      
      // 오류 시 기본 통계 반환
      return {
        subscription: 'FREE',
        tokensUsed: 0,
        limit: SUBSCRIPTION_LIMITS.FREE,
        remaining: SUBSCRIPTION_LIMITS.FREE,
        percentage: 0,
        lastReset: new Date().toISOString()
      };
    }
  }
  
  /**
   * 토큰 수 추정 (영어 기준)
   * @param {string[]} texts - 번역할 텍스트 배열
   * @returns {number} - 예상 토큰 수
   */
  function estimateTokens(texts) {
    try {
      // 영어 기준 1단어 = 약 1.3 토큰
      const tokenRatio = 1.3;
      
      // 텍스트 배열이 아니면 빈 배열로 간주
      if (!Array.isArray(texts)) {
        console.warn("[번역 익스텐션] 유효하지 않은 texts 배열:", texts);
        return 0;
      }
      
      // 모든 텍스트의 단어 수 계산
      const wordCount = texts.reduce((count, text) => {
        if (typeof text !== 'string') {
          return count; // 문자열이 아닌 항목은 건너뜀
        }
        
        // 단어 수 추정 (공백으로 분리)
        return count + text.split(/\s+/).length;
      }, 0);
      
      // 토큰 수 추정 및 10% 버퍼 추가
      return Math.ceil(wordCount * tokenRatio * 1.1);
    } catch (error) {
      console.error("[번역 익스텐션] 토큰 수 추정 오류:", error);
      
      // 최소한의 토큰 수 반환 (오류 방지)
      return texts && Array.isArray(texts) ? texts.length * 5 : 10;
    }
  }
  
  /**
   * 구독 등급 설정 (결제 처리 후 호출)
   * @param {string} level - 구독 등급 (FREE, BASIC)
   * @returns {Promise<boolean>} - 성공 여부
   */
  async function setSubscription(level) {
    try {
      // 유효한 구독 등급인지 확인
      if (!SUBSCRIPTION_LIMITS.hasOwnProperty(level)) {
        console.warn("[번역 익스텐션] 유효하지 않은 구독 등급:", level);
        return false;
      }
      
      return new Promise((resolve) => {
        try {
          chrome.storage.sync.set({ subscription: level }, () => {
            // 크롬 런타임 에러 체크
            if (chrome.runtime.lastError) {
              console.warn("[번역 익스텐션] 구독 저장 오류:", chrome.runtime.lastError);
              resolve(false);
              return;
            }
            
            // 이벤트 발생 (구독 업데이트)
            try {
              window.dispatchEvent(new CustomEvent('subscription:updated', {
                detail: { subscription: level }
              }));
            } catch (eventError) {
              console.error("[번역 익스텐션] 이벤트 발생 오류:", eventError);
            }
            
            resolve(true);
          });
        } catch (storageError) {
          console.error("[번역 익스텐션] 스토리지 저장 오류:", storageError);
          resolve(false);
        }
      });
    } catch (error) {
      console.error("[번역 익스텐션] 구독 설정 오류:", error);
      return false;
    }
  }
  
  /**
   * 월별 사용량 리셋 체크
   * @returns {Promise<boolean>} - 리셋 여부
   */
  async function checkAndResetMonthlyUsage() {
    try {
      const usage = await getCurrentUsage();
      const currentMonth = getCurrentMonth();
      
      // 현재 저장된 월과 현재 월이 다르면 리셋
      if (usage.month !== currentMonth) {
        const newUsage = {
          month: currentMonth,
          tokensUsed: 0,
          lastReset: new Date().toISOString()
        };
        
        return new Promise((resolve) => {
          try {
            chrome.storage.sync.set({ usage: newUsage }, () => {
              // 크롬 런타임 에러 체크
              if (chrome.runtime.lastError) {
                console.warn("[번역 익스텐션] 사용량 리셋 오류:", chrome.runtime.lastError);
                resolve(false);
                return;
              }
              
              console.log('[번역 익스텐션] 월간 사용량 리셋 완료');
              
              // 이벤트 발생 (사용량 리셋)
              try {
                window.dispatchEvent(new CustomEvent('usage:reset', {
                  detail: { usage: newUsage }
                }));
              } catch (eventError) {
                console.error("[번역 익스텐션] 이벤트 발생 오류:", eventError);
              }
              
              resolve(true);
            });
          } catch (storageError) {
            console.error("[번역 익스텐션] 스토리지 저장 오류:", storageError);
            resolve(false);
          }
        });
      }
      
      return false;
    } catch (error) {
      console.error("[번역 익스텐션] 월별 사용량 리셋 체크 오류:", error);
      return false;
    }
  }
  
  /**
   * 모든 구독 한도 가져오기
   * @returns {Object} - 구독 한도 객체
   */
  function getLimits() {
    return { ...SUBSCRIPTION_LIMITS };
  }
  
  /**
   * 구독 등급을 사람이 읽기 쉬운 형태로 변환
   * @param {string} subscription - 구독 등급 코드
   * @returns {string} - 표시 이름
   */
  function getSubscriptionDisplayName(subscription) {
    try {
      switch (subscription) {
        case 'BASIC': return "기본 ($5/월)";
        case 'FREE':
        default: return "무료";
      }
    } catch (error) {
      console.error("[번역 익스텐션] 구독 표시 이름 변환 오류:", error);
      return "무료"; // 기본값 반환
    }
  }
  
  // 초기화 - 사용량 캐싱 (시작 시 1회)
  try {
    getUsageStats();
  } catch (initError) {
    console.error("[번역 익스텐션] 초기 사용량 캐싱 오류:", initError);
  }
  
  // 공개 API
  return {
    getCurrentSubscription,
    getCurrentUsage,
    recordUsage,
    canTranslate,
    getUsageStats,
    estimateTokens,
    setSubscription,
    checkAndResetMonthlyUsage,
    getLimits,
    getSubscriptionDisplayName
  };
})();

// 모듈 내보내기
window.UsageManager = UsageManager;