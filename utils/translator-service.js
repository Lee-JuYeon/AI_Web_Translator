// translator-service.js - 개선된 리팩토링 버전
const TranslatorService = (function() {
  'use strict';
  
  // 이미 초기화된 경우 중복 실행 방지
  if (window.translatorServiceInitialized) {
    console.log("[번역 익스텐션] TranslatorService 이미 초기화됨");
    return window.TranslatorService;
  }
  
  // 초기화 플래그 설정
  window.translatorServiceInitialized = true;
  
  // 기본 설정
  const DEFAULT_SETTINGS = {
    workerEndpoint: 'https://translate-worker.redofyear2.workers.dev',
    targetLang: 'ko',  // 대상 언어 (한국어)
    separator: "||TRANSLATE_SEPARATOR||",
    maxRetryCount: 2,  // 오류 발생 시 최대 재시도 횟수
    retryDelay: 1000,  // 재시도 사이의 지연 시간(ms)
    timeout: 20000,    // 요청 타임아웃(ms)
    forceTranslation: false, // 캐시된 결과가 있어도 강제로 번역
    useFallbackApi: true,   // 기본 API 실패 시 대체 API 사용
    batchSize: 40      // 배치 크기
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
    supportedLanguages: [],  // languages.json에서 동적으로 로드할 예정
    languagesLoaded: false   // 언어 목록 로드 상태
  };
  
  /**
   * 언어 목록 로드하기
   * @returns {Promise<Array>} - 지원 언어 코드 배열
   */
  async function loadSupportedLanguages() {
    if (state.languagesLoaded && state.supportedLanguages.length > 0) {
      return state.supportedLanguages;
    }

    try {
      const response = await fetch('../languages.json');
      const data = await response.json();
      
      if (data && data.languages && Array.isArray(data.languages)) {
        // 언어 코드만 추출하여 저장
        state.supportedLanguages = data.languages.map(lang => lang.code);
        state.languagesLoaded = true;
        return state.supportedLanguages;
      }
    } catch (error) {
      console.error('[번역 익스텐션] 언어 목록 로드 오류:', error);
      // 오류 시 기본 언어 목록 사용
      state.supportedLanguages = ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de'];
    }
    
    state.languagesLoaded = true;
    return state.supportedLanguages;
  }
  
  // 초기화 시 언어 목록 로드 시작 (비동기)
  loadSupportedLanguages();
  
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
          const cachedTranslation = await window.CacheManager.get(text, translationOptions.targetLang);
          
          if (cachedTranslation) {
            // 내부 캐시에도 저장
            state.cachedTranslations.set(cacheKey, cachedTranslation);
            return cachedTranslation;
          }
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
      
      return text; // 오류 시 원본 반환
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
      if (!Array.isArray(texts) || texts.length === 0) {
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
      
      // 캐시 처리 함수
      const processCacheResults = async () => {
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
                cachedResults[i] = null;
                allCached = false;
              }
            } catch (error) {
              cachedResults[i] = null;
              allCached = false;
            }
          } else {
            cachedResults[i] = null;
            allCached = false;
          }
        }
        
        return { cachedResults, allCached };
      };
      
      // 캐시 저장 함수
      const saveToCaches = (originalText, translatedText, targetLang) => {
        if (!originalText || !translatedText) return;
        
        const cacheKey = `${targetLang}:${originalText}`;
        state.cachedTranslations.set(cacheKey, translatedText);
          
        if (window.CacheManager) {
          window.CacheManager.set(originalText, translatedText, targetLang);
        }
      };
      
      // 강제 번역이 아닌 경우 캐시 확인
      if (!translationOptions.forceTranslation) {
        const { cachedResults, allCached } = await processCacheResults();
        
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
        
        // 번역 요청
        try {
          const translatedTexts = await requestTranslation(textsToTranslate, translationOptions);
          
          // 번역 결과를 원래 위치에 삽입
          for (let i = 0; i < translatedTexts.length; i++) {
            const originalIndex = textsToTranslateIndices[i];
            cachedResults[originalIndex] = translatedTexts[i];
            
            // 캐시 저장
            saveToCaches(textItems[originalIndex], translatedTexts[i], translationOptions.targetLang);
          }
          
          // 빈 결과는 원본으로 대체
          for (let i = 0; i < cachedResults.length; i++) {
            if (cachedResults[i] === null) {
              cachedResults[i] = textItems[i];
            }
          }
          
          return cachedResults;
        } catch (error) {
          console.error("[번역 익스텐션] 번역 요청 오류:", error);
          
          // 번역 실패 시 캐시된 결과 + 원본 텍스트 반환
          for (let i = 0; i < cachedResults.length; i++) {
            if (cachedResults[i] === null) {
              cachedResults[i] = textItems[i];
            }
          }
          
          state.lastError = error;
          state.errorCount++;
          
          return cachedResults;
        }
      } else {
        // 강제 번역 - 캐시 무시하고 모두 번역
        const translatedTexts = await requestTranslation(nonEmptyTexts, translationOptions);
        
        // 빈 텍스트와 번역 결과 결합
        const results = new Array(textItems.length);
        let translatedIndex = 0;
        
        for (let i = 0; i < textItems.length; i++) {
          if (textItems[i]) {
            results[i] = translatedTexts[translatedIndex] || textItems[i];
            translatedIndex++;
            
            // 캐시 업데이트 (오류가 없는 경우)
            if (results[i] !== textItems[i]) {
              saveToCaches(textItems[i], results[i], translationOptions.targetLang);
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
      
      return texts; // 오류 시 원본 반환
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
      if (!Array.isArray(texts) || texts.length === 0) {
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
          
          // API 응답 상태 코드에 따른 처리
          switch (true) {
            // 서버 오류 또는 레이트 리밋 초과 (재시도 가능)
            case (response.status >= 500 || response.status === 429):
              if (options.retryCount < settings.maxRetryCount) {
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
              break;
              
            // 클라이언트 오류 (400번대) - 재시도해도 같은 결과 예상
            default:
              break;
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
      
      // 모든 시도 실패, 원본 텍스트 반환
      return texts;
    }
  }
  
  /**
   * 배치 단위로 텍스트 번역
   * @param {string[]} texts - 번역할 텍스트 배열
   * @param {number} batchSize - 배치당 최대 항목 수
   * @param {number} maxConcurrent - 최대 동시 실행 배치 수
   * @param {Object} options - 번역 옵션
   * @returns {Promise<Array>} 번역 결과 배열
   */
  async function translateInBatches(texts, batchSize = settings.batchSize, maxConcurrent = 3, options = {}) {
    try {
      if (!Array.isArray(texts) || texts.length === 0) {
        return [];
      }
      
      // 배치 크기 조정 (최소 5, 최대 100)
      const actualBatchSize = Math.min(100, Math.max(5, batchSize));
      
      // 결과 저장용 배열
      const results = new Array(texts.length);
      const translationOptions = {
        targetLang: options.targetLang || settings.targetLang,
        forceTranslation: options.forceTranslation || settings.forceTranslation
      };
      
      // 배치로 나누기
      const batches = [];
      for (let i = 0; i < texts.length; i += actualBatchSize) {
        batches.push({
          texts: texts.slice(i, i + actualBatchSize),
          startIndex: i
        });
      }
      
      // 프로세스 진행 상태 저장
      let completed = 0;
      const total = batches.length;
      let cachedCount = 0;
      let newCount = 0;
      
      // 이벤트 발행
      safeDispatchEvent('translation:batch-start', { 
        total, 
        batchSize: actualBatchSize 
      });
      
      // 배치 처리 함수
      const processBatch = async (batch) => {
        try {
          const translations = await translateTexts(batch.texts, translationOptions);
          
          // 원래 위치에 결과 저장
          for (let i = 0; i < translations.length; i++) {
            const resultIndex = batch.startIndex + i;
            if (resultIndex < results.length) {
              
              const isFromCache = translations[i] === batch.texts[i];
              if (isFromCache) {
                cachedCount++;
              } else {
                newCount++;
              }
              
              results[resultIndex] = {
                original: batch.texts[i],
                translated: translations[i]
              };
            }
          }
          
          // 진행 상태 업데이트
          completed++;
          
          // 배치 완료 이벤트 발행
          safeDispatchEvent('translation:batch-complete', {
            completed,
            total,
            cachedCount,
            newCount
          });
          
          return translations;
        } catch (error) {
          console.error("[번역 익스텐션] 배치 처리 오류:", error);
          
          // 오류 발생 시 원본 텍스트 반환
          for (let i = 0; i < batch.texts.length; i++) {
            const resultIndex = batch.startIndex + i;
            if (resultIndex < results.length) {
              results[resultIndex] = {
                original: batch.texts[i],
                translated: batch.texts[i]
              };
            }
          }
          
          // 진행 상태 업데이트
          completed++;
          
          // 배치 오류 이벤트 발행
          safeDispatchEvent('translation:batch-error', {
            completed,
            total,
            error: error.message
          });
          
          return batch.texts;
        }
      };
      
      // 병렬 처리를 위한 배치 그룹 처리
      for (let i = 0; i < batches.length; i += maxConcurrent) {
        const currentBatches = batches.slice(i, i + maxConcurrent);
        await Promise.all(currentBatches.map(processBatch));
      }
      
      // 완료 이벤트 발행
      safeDispatchEvent('translation:batches-complete', {
        total: texts.length,
        cachedCount,
        newCount
      });
      
      return results;
    } catch (error) {
      console.error("[번역 익스텐션] 배치 번역 오류:", error);
      
      // 오류 시 원본 텍스트 반환
      return texts.map(text => ({
        original: text,
        translated: text
      }));
    }
  }
  
  /**
   * 안전한 이벤트 발행
   * @private
   * @param {string} eventName - 이벤트 이름
   * @param {Object} detail - 이벤트 상세 정보
   */
  function safeDispatchEvent(eventName, detail = {}) {
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    } catch (error) {
      console.error(`[번역 익스텐션] 이벤트 발행 오류 (${eventName}):`, error);
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
   * 현재 상태 가져오기
   * @returns {Object} - 현재 상태
   */
  function getStatus() {
    return {
      activeRequests: state.activeRequests,
      totalProcessed: state.totalProcessed,
      errorCount: state.errorCount,
      cacheSize: state.cachedTranslations.size,
      lastError: state.lastError ? state.lastError.message : null
    };
  }
  
  /**
   * 설정 업데이트
   * @param {Object} newSettings - 새 설정 값
   */
  function updateSettings(newSettings) {
    if (!newSettings) return;
    settings = { ...settings, ...newSettings };
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
   * @returns {Promise<Array>} - 지원 언어 코드 배열
   */
  async function getSupportedLanguages() {
    return await loadSupportedLanguages();
  }
  
  /**
   * 번역 가능 여부 테스트
   * @returns {Promise<boolean>} - 번역 가능 여부
   */
  async function testConnection() {
    try {
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
  
  // 공개 API
  return {
    translateText,
    translateTexts,
    translateInBatches,
    clearCache,
    getStatus,
    updateSettings,
    getSettings,
    getSupportedLanguages,
    testConnection
  };
})();

// 모듈 내보내기
window.TranslatorService = TranslatorService;