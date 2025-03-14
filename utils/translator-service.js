// translator-service.js - 개선된 번역 서비스 모듈 (API 요청 제한 및 오류 처리 강화)

const TranslatorService = (function() {
  'use strict';
  
  // 기본 설정
  const DEFAULT_SETTINGS = {
    workerEndpoint: 'https://translate-worker.redofyear2.workers.dev',
    targetLang: 'ko',  // 대상 언어 (한국어)
    separator: "||TRANSLATE_SEPARATOR||",
    maxRetryCount: 2,  // 오류 발생 시 최대 재시도 횟수
    retryDelay: 2000,  // 재시도 사이의 지연 시간(ms) - 증가
    timeout: 30000,    // 요청 타임아웃(ms) - 증가
    forceTranslation: false, // 캐시된 결과가 있어도 강제로 번역
    useFallbackApi: true,   // 기본 API 실패 시 대체 API 사용
    minBatchSize: 5,    // 최소 배치 크기
    maxBatchSize: 50,   // 최대 배치 크기 - 감소
    requestLimit: 10,   // 10초당 최대 요청 수 - 추가
    requestWindow: 10000, // 요청 제한 윈도우(ms) - 추가
    rateLimitDelay: 5000 // 속도 제한 시 지연 시간(ms) - 추가
  };
  
  // 현재 설정
  let settings = {...DEFAULT_SETTINGS};
  
  // 서비스 상태
  const state = {
    activeRequests: 0,
    cachedTranslations: new Map(),
    totalProcessed: 0,
    errorCount: 0,
    lastError: null,
    supportedLanguages: ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'ru', 'pt', 'ar', 'it'],
    recentRequests: [], // 최근 요청 시간 추적 - 추가
    rateLimited: false, // 속도 제한 상태 - 추가
    rateLimitTimer: null // 속도 제한 타이머 - 추가
  };
  
  /**
   * 요청 횟수 제한 확인
   * @returns {boolean} - 요청 가능 여부
   */
  function canMakeRequest() {
    const now = Date.now();
    
    // 속도 제한 상태 확인
    if (state.rateLimited) {
      return false;
    }
    
    // 요청 윈도우보다 오래된 요청 제거
    state.recentRequests = state.recentRequests.filter(time => 
      now - time < settings.requestWindow
    );
    
    // 최근 요청 수 확인
    if (state.recentRequests.length >= settings.requestLimit) {
      console.warn(`[번역 익스텐션] 요청 한도 초과: ${settings.requestLimit}/${settings.requestWindow}ms`);
      
      // 속도 제한 설정
      state.rateLimited = true;
      
      // 속도 제한 해제 타이머 설정
      state.rateLimitTimer = setTimeout(() => {
        state.rateLimited = false;
        state.recentRequests = []; // 요청 기록 초기화
        console.log('[번역 익스텐션] 요청 제한 해제됨');
      }, settings.rateLimitDelay);
      
      return false;
    }
    
    // 새 요청 추가
    state.recentRequests.push(now);
    return true;
  }
  
  /**
   * 텍스트 번역
   * @param {string} text - 번역할 텍스트
   * @param {Object} options - 번역 옵션
   * @returns {Promise<string>} - 번역된 텍스트
   */
  async function translateText(text, options = {}) {
    try {
      // 입력 검증
      if (!text || typeof text !== 'string' || text.trim() === '') {
        return text;
      }
      
      const translationOptions = {
        targetLang: options.targetLang || settings.targetLang,
        forceTranslation: options.forceTranslation || settings.forceTranslation
      };
      
      // 캐시 확인 (강제 번역이 아닌 경우)
      if (!translationOptions.forceTranslation) {
        const cacheKey = `${translationOptions.targetLang}:${text}`;
        
        if (state.cachedTranslations.has(cacheKey)) {
          return state.cachedTranslations.get(cacheKey);
        }
        
        // CacheManager 모듈이 있는 경우 사용
        if (window.CacheManager) {
          try {
            const cachedTranslation = await window.CacheManager.get(text, translationOptions.targetLang);
            
            if (cachedTranslation) {
              // 내부 캐시에도 저장
              state.cachedTranslations.set(cacheKey, cachedTranslation);
              return cachedTranslation;
            }
          } catch (cacheError) {
            console.warn("[번역 익스텐션] 캐시 조회 오류:", cacheError);
          }
        }
      }
      
      // 속도 제한 확인
      if (!canMakeRequest()) {
        console.warn("[번역 익스텐션] 요청 속도 제한으로 인해 번역 지연됨");
        
        // 일정 시간 후 재시도 (속도 제한이 해제될 때까지)
        await new Promise(resolve => setTimeout(resolve, settings.rateLimitDelay));
        
        // 속도 제한이 여전히 활성화 상태면 캐시 실패로 간주하고 원본 반환
        if (state.rateLimited) {
          return text;
        }
      }
      
      // 단일 텍스트를 배열로 변환하여 처리
      const translations = await translateTexts([text], options);
      
      // 번역 결과 반환
      return translations[0] || text;
    } catch (error) {
      console.error("[번역 익스텐션] 텍스트 번역 오류:", error);
      state.lastError = error;
      state.errorCount++;
      
      // 오류 발생 시 원본 텍스트 반환
      return text;
    }
  }
  
  /**
   * 텍스트 배열 번역
   * @param {string[]} texts - 번역할 텍스트 배열
   * @param {Object} options - 번역 옵션
   * @returns {Promise<string[]>} - 번역된 텍스트 배열
   */
  async function translateTexts(texts, options = {}) {
    try {
      // 입력 검증
      if (!texts || !Array.isArray(texts) || texts.length === 0) {
        return [];
      }
      
      const translationOptions = {
        targetLang: options.targetLang || settings.targetLang,
        forceTranslation: options.forceTranslation || settings.forceTranslation,
        retryCount: options.retryCount || 0,
        useFallbackApi: options.useFallbackApi !== undefined ? options.useFallbackApi : settings.useFallbackApi
      };
      
      // 번역 요청 데이터 준비
      const textItems = texts.map(text => String(text || '').trim());
      
      // 빈 텍스트 필터링
      const nonEmptyTexts = textItems.filter(text => text);
      
      if (nonEmptyTexts.length === 0) {
        return texts; // 모두 빈 텍스트인 경우 원본 반환
      }
      
      // 배치 크기 제한 - 최대 20개로 제한하여 요청 부하 감소
      const maxItemsPerRequest = 20;
      const limitedTexts = nonEmptyTexts.length > maxItemsPerRequest ?
        nonEmptyTexts.slice(0, maxItemsPerRequest) : nonEmptyTexts;
      
      if (nonEmptyTexts.length > maxItemsPerRequest) {
        console.log(`[번역 익스텐션] 요청 크기 제한: ${nonEmptyTexts.length}개 항목 중 ${maxItemsPerRequest}개만 처리`);
      }
      
      // 캐시 확인 (강제 번역이 아닌 경우)
      if (!translationOptions.forceTranslation) {
        // 이미 캐시된 항목 확인
        const cachedResults = new Array(textItems.length);
        let allCached = true;
        
        for (let i = 0; i < textItems.length; i++) {
          const text = textItems[i];
          
          if (!text) {
            cachedResults[i] = text;
            continue;
          }
          
          const cacheKey = `${translationOptions.targetLang}:${text}`;
          
          if (state.cachedTranslations.has(cacheKey)) {
            cachedResults[i] = state.cachedTranslations.get(cacheKey);
          } else if (window.CacheManager) {
            try {
              const cachedTranslation = await window.CacheManager.get(text, translationOptions.targetLang);
              
              if (cachedTranslation) {
                cachedResults[i] = cachedTranslation;
                // 내부 캐시에도 저장
                state.cachedTranslations.set(cacheKey, cachedTranslation);
              } else {
                // 캐시 없음
                cachedResults[i] = null;
                allCached = false;
              }
            } catch (cacheError) {
              // 캐시 오류
              cachedResults[i] = null;
              allCached = false;
            }
          } else {
            // CacheManager 없음
            cachedResults[i] = null;
            allCached = false;
          }
        }
        
        // 모두 캐시된 경우 바로 반환
        if (allCached) {
          return cachedResults;
        }
        
        // 캐시되지 않은 항목만 번역
        const textsToTranslate = [];
        const textsToTranslateIndices = [];
        
        for (let i = 0; i < textItems.length; i++) {
          if (cachedResults[i] === null && textItems[i]) {
            textsToTranslate.push(textItems[i]);
            textsToTranslateIndices.push(i);
          }
        }
        
        // 번역이 필요한 텍스트가 없는 경우 캐시 결과 반환
        if (textsToTranslate.length === 0) {
          return cachedResults;
        }
        
        // 속도 제한 확인
        if (!canMakeRequest()) {
          console.warn("[번역 익스텐션] 요청 속도 제한으로 인해 번역 지연됨");
          
          // 일정 시간 후 재시도
          await new Promise(resolve => setTimeout(resolve, settings.rateLimitDelay));
          
          // 속도 제한이 여전히 활성화 상태면 캐시된 항목만 반환하고 나머지는 원본 사용
          if (state.rateLimited) {
            for (let i = 0; i < cachedResults.length; i++) {
              if (cachedResults[i] === null) {
                cachedResults[i] = textItems[i];
              }
            }
            return cachedResults;
          }
        }
        
        // 번역 요청
        try {
          const limitedTranslateTexts = textsToTranslate.length > maxItemsPerRequest ?
            textsToTranslate.slice(0, maxItemsPerRequest) : textsToTranslate;
          
          const limitedIndices = textsToTranslateIndices.length > maxItemsPerRequest ?
            textsToTranslateIndices.slice(0, maxItemsPerRequest) : textsToTranslateIndices;
          
          const translatedTexts = await requestTranslation(limitedTranslateTexts, translationOptions);
          
          // 번역 결과를 원래 위치에 삽입
          for (let i = 0; i < translatedTexts.length; i++) {
            const originalIndex = limitedIndices[i];
            cachedResults[originalIndex] = translatedTexts[i];
            
            // 캐시 저장
            if (translatedTexts[i] && textItems[originalIndex]) {
              const cacheKey = `${translationOptions.targetLang}:${textItems[originalIndex]}`;
              state.cachedTranslations.set(cacheKey, translatedTexts[i]);
              
              if (window.CacheManager) {
                try {
                  window.CacheManager.set(textItems[originalIndex], translatedTexts[i], translationOptions.targetLang);
                } catch (cacheError) {
                  console.warn("[번역 익스텐션] 캐시 저장 오류:", cacheError);
                }
              }
            }
          }
          
          // 결과 완성 - 빈 결과는 원본으로 대체
          for (let i = 0; i < cachedResults.length; i++) {
            if (cachedResults[i] === null || cachedResults[i] === undefined) {
              cachedResults[i] = textItems[i];
            }
          }
          
          return cachedResults;
        } catch (translationError) {
          // 번역 실패 - 캐시된 결과 + 원본 텍스트 반환
          console.error("[번역 익스텐션] 번역 요청 오류:", translationError);
          
          for (let i = 0; i < cachedResults.length; i++) {
            if (cachedResults[i] === null) {
              cachedResults[i] = textItems[i]; // 번역 실패 시 원본 사용
            }
          }
          
          state.lastError = translationError;
          state.errorCount++;
          
          return cachedResults;
        }
      } else {
        // 강제 번역 - 캐시 무시하고 모두 번역
        // 속도 제한 확인
        if (!canMakeRequest()) {
          console.warn("[번역 익스텐션] 요청 속도 제한으로 인해 번역 지연됨");
          
          // 일정 시간 후 재시도
          await new Promise(resolve => setTimeout(resolve, settings.rateLimitDelay));
          
          // 속도 제한이 여전히 활성화 상태면 원본 반환
          if (state.rateLimited) {
            return texts;
          }
        }
        
        const limitedNonEmptyTexts = nonEmptyTexts.length > maxItemsPerRequest ?
          nonEmptyTexts.slice(0, maxItemsPerRequest) : nonEmptyTexts;
        
        const translatedTexts = await requestTranslation(limitedNonEmptyTexts, translationOptions);
        
        // 빈 텍스트와 번역 결과 결합
        const results = new Array(textItems.length);
        let translatedIndex = 0;
        
        for (let i = 0; i < textItems.length; i++) {
          if (textItems[i]) {
            results[i] = translatedTexts[translatedIndex] || textItems[i];
            translatedIndex++;
            
            // 캐시 업데이트
            if (results[i] !== textItems[i]) {
              const cacheKey = `${translationOptions.targetLang}:${textItems[i]}`;
              state.cachedTranslations.set(cacheKey, results[i]);
              
              if (window.CacheManager) {
                try {
                  window.CacheManager.set(textItems[i], results[i], translationOptions.targetLang);
                } catch (cacheError) {
                  console.warn("[번역 익스텐션] 캐시 저장 오류:", cacheError);
                }
              }
            }
          } else {
            results[i] = textItems[i]; // 빈 텍스트는 그대로 유지
          }
        }
        
        return results;
      }
    } catch (error) {
      console.error("[번역 익스텐션] 텍스트 배열 번역 오류:", error);
      state.lastError = error;
      state.errorCount++;
      
      // 오류 발생 시 원본 텍스트 배열 반환
      return texts;
    }
  }
  
  /**
   * 번역 API 요청
   * @private
   * @param {string[]} texts - 번역할 텍스트 배열
   * @param {Object} options - 번역 옵션
   * @returns {Promise<string[]>} - 번역된 텍스트 배열
   */
  async function requestTranslation(texts, options) {
    try {
      // 입력 검증
      if (!texts || !Array.isArray(texts) || texts.length === 0) {
        return [];
      }
      
      // 활성 요청 상태 업데이트
      state.activeRequests++;
      
      try {
        // 번역 요청 데이터 구성
        const requestData = {
          texts: texts,
          targetLang: options.targetLang || settings.targetLang,
          separator: settings.separator
        };
        
        // 번역 API 호출 (타임아웃 적용)
        const fetchPromise = fetch(settings.workerEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestData)
        });
        
        // 타임아웃 Promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('번역 요청 타임아웃')), settings.timeout);
        });
        
        // 요청 또는 타임아웃 중 먼저 발생하는 것 처리
        const response = await Promise.race([fetchPromise, timeoutPromise]);
        
        if (!response.ok) {
          let errorMessage = "번역 API 오류";
          
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || response.statusText;
          } catch (e) {
            errorMessage = response.statusText;
          }
          
          // 429 오류 (Too Many Requests)일 경우 속도 제한 활성화
          if (response.status === 429) {
            console.warn("[번역 익스텐션] API 속도 제한 감지됨:", errorMessage);
            
            // 속도 제한 설정
            state.rateLimited = true;
            
            // 속도 제한 해제 타이머 설정 (더 긴 지연 적용)
            if (state.rateLimitTimer) {
              clearTimeout(state.rateLimitTimer);
            }
            
            state.rateLimitTimer = setTimeout(() => {
              state.rateLimited = false;
              state.recentRequests = []; // 요청 기록 초기화
              console.log('[번역 익스텐션] API 속도 제한 해제됨');
            }, settings.rateLimitDelay * 2); // 더 긴 지연 시간 적용
          }
          
          // 재시도 가능한 오류인 경우
          if ((response.status >= 500 || response.status === 429) && 
              options.retryCount < settings.maxRetryCount) {
            
            console.warn(`[번역 익스텐션] API 오류, ${options.retryCount + 1}번째 재시도 중: ${errorMessage}`);
            
            // 지수 백오프 (재시도 횟수에 따라 대기 시간 증가)
            const delay = settings.retryDelay * Math.pow(2, options.retryCount);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // 재시도
            state.activeRequests--;
            return translateTexts(texts, {
              ...options,
              retryCount: options.retryCount + 1
            });
          }
          
          // 대체 API 사용 가능한 경우 (메인 API 실패 시)
          if (options.useFallbackApi && !options.usingFallbackApi) {
            console.warn(`[번역 익스텐션] 메인 API 실패, 대체 API 사용: ${errorMessage}`);
            
            // 대체 API 호출 설정
            state.activeRequests--;
            return translateTexts(texts, {
              ...options,
              usingFallbackApi: true,
              retryCount: 0
            });
          }
          
          throw new Error(`번역 API 오류: ${errorMessage}`);
        }
        
        // 응답 데이터 파싱
        const data = await response.json();
        
        // 성공 응답 확인
        if (data.success && Array.isArray(data.translations)) {
          // 통계 업데이트
          state.totalProcessed += texts.length;
          
          // 번역 결과 반환
          return data.translations;
        } else {
          throw new Error(data.error || "API에서 유효한 응답을 받지 못했습니다.");
        }
      } finally {
        // 활성 요청 상태 업데이트
        state.activeRequests--;
      }
    } catch (error) {
      console.error(`[번역 익스텐션] 번역 API 요청 오류: ${error.message}`);
      
      // 재시도 가능하고 최대 재시도 횟수 미만인 경우
      if (options.retryCount < settings.maxRetryCount) {
        console.warn(`[번역 익스텐션] ${options.retryCount + 1}번째 재시도 중`);
        
        // 지수 백오프 (재시도 횟수에 따라 대기 시간 증가)
        const delay = settings.retryDelay * Math.pow(2, options.retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // 재시도
        return translateTexts(texts, {
          ...options,
          retryCount: options.retryCount + 1
        });
      }
      
      // 대체 API 사용 가능한 경우 (최대 재시도 실패 후)
      if (options.useFallbackApi && !options.usingFallbackApi) {
        console.warn(`[번역 익스텐션] 메인 API 재시도 실패, 대체 API 사용`);
        
        // 대체 API 호출 설정
        return translateTexts(texts, {
          ...options,
          usingFallbackApi: true,
          retryCount: 0
        });
      }
      
      // 모든 시도 실패, 빈 배열 대신 원본 텍스트 반환 (UX 개선)
      return texts;
    }
  }
  
  /**
   * 번역 캐시 초기화
   */
  function clearCache() {
    try {
      // 내부 캐시 초기화
      state.cachedTranslations.clear();
      
      // CacheManager 모듈이 있는 경우 같이 초기화
      if (window.CacheManager && typeof window.CacheManager.cleanupExpired === 'function') {
        window.CacheManager.cleanupExpired();
      }
      
      console.log("[번역 익스텐션] 번역 캐시 초기화 완료");
    } catch (error) {
      console.error("[번역 익스텐션] 캐시 초기화 오류:", error);
    }
  }
  
  /**
   * 현재 캐시 통계 가져오기
   * @returns {Object} - 캐시 통계
   */
  function getCacheStats() {
    try {
      const stats = {
        internalCacheSize: state.cachedTranslations.size,
        externalCacheStats: null,
        rateLimited: state.rateLimited
      };
      
      // CacheManager 모듈이 있는 경우 외부 캐시 통계 가져오기
      if (window.CacheManager && typeof window.CacheManager.getStats === 'function') {
        try {
          stats.externalCacheStats = window.CacheManager.getStats();
        } catch (error) {
          console.warn("[번역 익스텐션] 외부 캐시 통계 가져오기 오류:", error);
        }
      }
      
      return stats;
    } catch (error) {
      console.error("[번역 익스텐션] 캐시 통계 가져오기 오류:", error);
      return { internalCacheSize: state.cachedTranslations.size };
    }
  }
  
  /**
   * 현재 상태 가져오기
   * @returns {Object} - 현재 상태
   */
  function getStatus() {
    return {
      activeRequests: state.activeRequests,
      totalProcessed: state.totalProcessed,
      errorCount: state.errorCount,
      cacheSize: state.cachedTranslations.size,
      lastError: state.lastError ? state.lastError.message : null,
      rateLimited: state.rateLimited,
      recentRequestCount: state.recentRequests.length
    };
  }
  
  /**
   * 속도 제한 상태 재설정
   */
  function resetRateLimit() {
    if (state.rateLimitTimer) {
      clearTimeout(state.rateLimitTimer);
      state.rateLimitTimer = null;
    }
    
    state.rateLimited = false;
    state.recentRequests = [];
    
    console.log("[번역 익스텐션] API 속도 제한 수동 재설정됨");
  }
  
  /**
   * 설정 업데이트
   * @param {Object} newSettings - 새 설정 값
   */
  function updateSettings(newSettings) {
    if (!newSettings) return;
    
    // 기존 설정 기억
    const oldSettings = { ...settings };
    
    // 설정 업데이트
    settings = { ...settings, ...newSettings };
    
    // 요청 제한 관련 설정이 변경된 경우 상태 초기화
    if (oldSettings.requestLimit !== settings.requestLimit || 
        oldSettings.requestWindow !== settings.requestWindow) {
      resetRateLimit();
    }
    
    console.log("[번역 익스텐션] 번역 서비스 설정 업데이트됨");
  }
  
  /**
   * 현재 설정 가져오기
   * @returns {Object} - 현재 설정
   */
  function getSettings() {
    return { ...settings };
  }
  
  /**
   * 지원하는 언어 목록 가져오기
   * @returns {Array} - 지원 언어 코드 배열
   */
  function getSupportedLanguages() {
    return [...state.supportedLanguages];
  }
  
  /**
   * 번역 가능 여부 테스트
   * @returns {Promise<boolean>} - 번역 가능 여부
   */
  async function testConnection() {
    try {
      // 속도 제한 확인
      if (state.rateLimited) {
        console.warn("[번역 익스텐션] API 속도 제한 상태에서 연결 테스트 불가");
        return false;
      }
      
      // 간단한 텍스트로 연결 테스트
      const testText = "Hello, world!";
      const testResult = await translateText(testText, { targetLang: 'ko' });
      
      // 번역 결과가 원본과 다르고 비어있지 않으면 성공
      return !!testResult && testResult !== testText;
    } catch (error) {
      console.error("[번역 익스텐션] 연결 테스트 오류:", error);
      return false;
    }
  }
  
  // 초기화: 일정 기간 후 자동으로 캐시 정리
  setInterval(() => {
    try {
      if (window.CacheManager && typeof window.CacheManager.cleanupExpired === 'function') {
        window.CacheManager.cleanupExpired();
        console.log("[번역 익스텐션] 자동 캐시 정리 완료");
      }
    } catch (error) {
      console.warn("[번역 익스텐션] 자동 캐시 정리 오류:", error);
    }
  }, 12 * 60 * 60 * 1000); // 12시간마다 실행
  
  // 공개 API
  return {
    translateText,
    translateTexts,
    clearCache,
    getCacheStats,
    getStatus,
    updateSettings,
    getSettings,
    getSupportedLanguages,
    testConnection,
    resetRateLimit
  };
})();

// 모듈 내보내기
window.TranslatorService = TranslatorService;