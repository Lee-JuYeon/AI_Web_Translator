// usage-manager.js - TonyConfig 활용 리팩토링 버전
const UsageManager = (function() {
  'use strict';
  
  // 이미 초기화된 경우 중복 실행 방지
  if (window.usageManagerInitialized) {
    console.log(`[${TonyConfig.APP_CONFIG.appName}] UsageManager 이미 초기화됨`);
    return window.UsageManager;
  }
  
  // 초기화 플래그 설정
  window.usageManagerInitialized = true;

  // 구독 등급별 월간 토큰 한도 (TonyConfig에서 가져옴)
  const SUBSCRIPTION_LIMITS = TonyConfig.APP_CONFIG.subscriptionLimits;

  /**
   * 현재 사용자 구독 등급 가져오기
   * @returns {Promise<string>} - 구독 등급 (FREE, BASIC)
   */
  async function getCurrentSubscription() {
    try {
      return new Promise((resolve) => {
        chrome.storage.sync.get('subscription', (data) => {
          const subscription = data && data.subscription ? data.subscription : 'FREE';
          
          switch (subscription) {
            case 'BASIC':
              resolve('BASIC');
              break;
            case 'FREE':
            default:
              resolve('FREE');
              break;
          }
        });
      });
    } catch (error) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 구독 정보 가져오기 오류:`, error);
      return 'FREE'; // 오류 시 기본값
    }
  }
  
  /**
   * 현재 월 사용량 가져오기
   * @returns {Promise<Object>} - 사용량 객체
   */
  async function getCurrentUsage() {
    try {
      return new Promise((resolve) => {
        chrome.storage.sync.get('usage', (data) => {
          const currentMonth = TonyConfig.getCurrentMonth();
          
          // 사용량 데이터가 없거나 이번 달 데이터가 아니면 초기화
          if (!data || !data.usage || !data.usage.month || data.usage.month !== currentMonth) {
            const newUsage = {
              month: currentMonth,
              tokensUsed: 0,
              lastReset: new Date().toISOString()
            };
            
            // 스토리지에 새 사용량 저장
            try {
              chrome.storage.sync.set({ usage: newUsage });
            } catch (storageError) {
              console.error(`[${TonyConfig.APP_CONFIG.appName}] 스토리지 저장 오류:`, storageError);
            }
            
            resolve(newUsage);
          } else {
            resolve(data.usage);
          }
        });
      });
    } catch (error) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 사용량 가져오기 오류:`, error);
      // 오류 시 기본값
      return {
        month: TonyConfig.getCurrentMonth(),
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
      // 유효한 토큰 수인지 확인
      if (typeof tokens !== 'number' || isNaN(tokens) || tokens <= 0) {
        return await getCurrentUsage();
      }
      
      const usage = await getCurrentUsage();
      const newTokensUsed = usage.tokensUsed + tokens;
      
      // 새 사용량으로 업데이트
      const newUsage = {
        ...usage,
        tokensUsed: newTokensUsed
      };
      
      return new Promise((resolve) => {
        chrome.storage.sync.set({ usage: newUsage }, () => {
          // 이벤트 발생 (사용량 업데이트)
          try {
            TonyConfig.safeDispatchEvent('usage:updated', {
              detail: { usage: newUsage }
            });
          } catch (eventError) {
            console.error(`[${TonyConfig.APP_CONFIG.appName}] 이벤트 발생 오류:`, eventError);
          }
          
          resolve(newUsage);
        });
      });
    } catch (error) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 사용량 기록 오류:`, error);
      return await getCurrentUsage();
    }
  }
  
  /**
   * 번역 가능 여부 확인
   * @param {number} estimatedTokens - 예상 토큰 수
   * @returns {Promise<boolean>} - 번역 가능 여부
   */
  async function canTranslate(estimatedTokens) {
    try {
      // 유효한 토큰 수인지 확인
      const tokenCount = typeof estimatedTokens === 'number' && !isNaN(estimatedTokens) ? estimatedTokens : 0;
      
      const subscription = await getCurrentSubscription();
      const limit = SUBSCRIPTION_LIMITS[subscription] || SUBSCRIPTION_LIMITS.FREE;
      
      const usage = await getCurrentUsage();
      
      // 현재 사용량 + 예상 토큰 <= 한도
      const isWithinLimit = (usage.tokensUsed + tokenCount) <= limit;
      
      // 한도 초과 시 이벤트 발생
      if (!isWithinLimit) {
        try {
          TonyConfig.safeDispatchEvent('usage:limit-exceeded', {
            detail: { 
              required: tokenCount,
              available: Math.max(0, limit - usage.tokensUsed)
            }
          });
        } catch (eventError) {
          console.error(`[${TonyConfig.APP_CONFIG.appName}] 이벤트 발생 오류:`, eventError);
        }
      }
      
      return isWithinLimit;
    } catch (error) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 번역 가능 여부 확인 오류:`, error);
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
        TonyConfig.safeDispatchEvent('usage:stats-ready', {
          detail: { stats }
        });
      } catch (eventError) {
        console.error(`[${TonyConfig.APP_CONFIG.appName}] 이벤트 발생 오류:`, eventError);
      }
      
      return stats;
    } catch (error) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 사용량 통계 가져오기 오류:`, error);
      
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
      
      // 텍스트 배열이 아니면 0 반환
      if (!Array.isArray(texts)) {
        return 0;
      }
      
      // 모든 텍스트의 단어 수 계산
      const wordCount = texts.reduce((count, text) => {
        if (typeof text !== 'string') {
          return count;
        }
        
        // 단어 수 추정 (공백으로 분리)
        return count + text.split(/\s+/).length;
      }, 0);
      
      // 토큰 수 추정 및 10% 버퍼 추가
      return Math.ceil(wordCount * tokenRatio * 1.1);
    } catch (error) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 토큰 수 추정 오류:`, error);
      
      // 최소한의 토큰 수 반환
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
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] 유효하지 않은 구독 등급:`, level);
        return false;
      }
      
      return new Promise((resolve) => {
        chrome.storage.sync.set({ subscription: level }, () => {
          if (chrome.runtime.lastError) {
            console.warn(`[${TonyConfig.APP_CONFIG.appName}] 구독 저장 오류:`, chrome.runtime.lastError);
            resolve(false);
            return;
          }
          
          // 이벤트 발생 (구독 업데이트)
          try {
            TonyConfig.safeDispatchEvent('subscription:updated', {
              detail: { subscription: level }
            });
          } catch (eventError) {
            console.error(`[${TonyConfig.APP_CONFIG.appName}] 이벤트 발생 오류:`, eventError);
          }
          
          resolve(true);
        });
      });
    } catch (error) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 구독 설정 오류:`, error);
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
      const currentMonth = TonyConfig.getCurrentMonth();
      
      // 현재 저장된 월과 현재 월이 다르면 리셋
      if (usage.month !== currentMonth) {
        const newUsage = {
          month: currentMonth,
          tokensUsed: 0,
          lastReset: new Date().toISOString()
        };
        
        return new Promise((resolve) => {
          chrome.storage.sync.set({ usage: newUsage }, () => {
            if (chrome.runtime.lastError) {
              console.warn(`[${TonyConfig.APP_CONFIG.appName}] 사용량 리셋 오류:`, chrome.runtime.lastError);
              resolve(false);
              return;
            }
            
            // 이벤트 발생 (사용량 리셋)
            try {
              TonyConfig.safeDispatchEvent('usage:reset', {
                detail: { usage: newUsage }
              });
            } catch (eventError) {
              console.error(`[${TonyConfig.APP_CONFIG.appName}] 이벤트 발생 오류:`, eventError);
            }
            
            resolve(true);
          });
        });
      }
      
      return false;
    } catch (error) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 월별 사용량 리셋 체크 오류:`, error);
      return false;
    }
  }
  
  /**
   * 구독 등급을 사람이 읽기 쉬운 형태로 변환
   * @param {string} subscription - 구독 등급 코드
   * @returns {string} - 표시 이름
   */
  function getSubscriptionDisplayName(subscription) {
    switch (subscription) {
      case 'BASIC':
        return "기본 ($5/월)";
      case 'FREE':
      default:
        return "무료";
    }
  }
  
  // 초기화 - 사용량 캐싱 (시작 시 1회)
  try {
    getUsageStats();
  } catch (initError) {
    console.error(`[${TonyConfig.APP_CONFIG.appName}] 초기 사용량 캐싱 오류:`, initError);
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
    getSubscriptionDisplayName
  };
})();

// 모듈 내보내기
window.UsageManager = UsageManager;