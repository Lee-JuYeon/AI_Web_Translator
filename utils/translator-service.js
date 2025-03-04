// utils/translator-service.js
const TranslatorService = (function() {
    'use strict';
    
    // 기본 설정
    const DEFAULT_SETTINGS = {
      workerEndpoint: 'https://translate-worker.redofyear2.workers.dev',
      targetLang: 'ko',  // 대상 언어 (한국어)
      separator: "||TRANSLATE_SEPARATOR||"
    };
    
    // 서비스 설정
    let settings = {...DEFAULT_SETTINGS};
    
    /**
     * 텍스트 배열을 번역
     * @param {string[]} texts - 번역할 텍스트 배열
     * @returns {Promise<string[]>} - 번역된 텍스트 배열
     */
    async function translateTexts(texts) {
      try {
        // 토큰 사용량 확인 (UsageManager 필요)
        const estimatedTokens = window.UsageManager.estimateTokens(texts);
        
        // 번역 가능 여부 확인
        const canTranslate = await window.UsageManager.canTranslate(estimatedTokens);
        
        if (!canTranslate) {
          // 이벤트 디스패치 (UI 처리는 별도 모듈에서)
          const event = new CustomEvent('translation:limit-exceeded');
          window.dispatchEvent(event);
          
          throw new Error("번역 한도를 초과했습니다. 구독 등급을 업그레이드하세요.");
        }
  
        // Worker API에 요청할 데이터 구성
        const requestData = {
          texts: texts,
          targetLang: settings.targetLang,
          separator: settings.separator
        };
  
        // Worker API 호출
        console.log("[번역 익스텐션] Worker API 호출 시작");
        const response = await fetch(settings.workerEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestData)
        });
  
        if (!response.ok) {
          let errorMessage = "Worker API 오류";
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || response.statusText;
          } catch (e) {
            errorMessage = response.statusText;
          }
          throw new Error(`Worker API 오류: ${errorMessage}`);
        }
  
        // 응답 데이터 파싱
        const data = await response.json();
        console.log("[번역 익스텐션] Worker API 응답 수신 완료");
  
        // 성공 응답 확인
        if (data.success && Array.isArray(data.translations)) {
          // 사용량 기록
          await window.UsageManager.recordUsage(estimatedTokens);
          
          // 캐시에 번역 결과 저장
          texts.forEach((text, index) => {
            if (text !== data.translations[index]) {
              window.CacheManager.set(text, data.translations[index], settings.targetLang);
            }
          });
          
          return data.translations;
        } else {
          throw new Error(data.error || "Worker API에서 유효한 응답을 받지 못했습니다.");
        }
      } catch (error) {
        console.error("[번역 익스텐션] Worker API 호출 오류:", error);
        throw error;
      }
    }
    
    /**
     * 텍스트 배열을 캐시 확인 후 필요한 경우만 API로 번역
     * @param {string[]} texts - 번역할 텍스트 배열
     * @returns {Promise<Object>} - { cachedTranslations, newTranslations }
     */
    async function translateWithCache(texts) {
      try {
        // 캐시 확인
        const cachePromises = texts.map(text => 
          window.CacheManager.get(text, settings.targetLang)
        );
        
        const cacheResults = await Promise.all(cachePromises);
        
        // 캐시 히트/미스 분류
        const cachedItems = [];
        const needTranslation = [];
        
        texts.forEach((text, index) => {
          if (cacheResults[index]) {
            cachedItems.push({
              original: text,
              translated: cacheResults[index]
            });
          } else {
            needTranslation.push(text);
          }
        });
        
        console.log(`[번역 익스텐션] 캐시 히트: ${cachedItems.length}개, 번역 필요: ${needTranslation.length}개`);
        
        // 번역이 필요한 경우만 API 호출
        let newItems = [];
        
        if (needTranslation.length > 0) {
          const translations = await translateTexts(needTranslation);
          
          newItems = needTranslation.map((text, index) => ({
            original: text,
            translated: translations[index] || text
          }));
        }
        
        return {
          cachedTranslations: cachedItems,
          newTranslations: newItems
        };
      } catch (error) {
        console.error("[번역 익스텐션] 번역 오류:", error);
        throw error;
      }
    }
    
    /**
     * 텍스트 배열을 배치로 나누어 번역
     * @param {string[]} texts - 번역할 텍스트 배열
     * @param {number} batchSize - 배치 크기
     * @param {number} maxConcurrent - 최대 동시 배치 수
     * @returns {Promise<Object[]>} - 번역 결과 객체 배열
     */
    async function translateInBatches(texts, batchSize = 40, maxConcurrent = 3) {
      try {
        // 중복 제거 (메모리 최적화)
        const uniqueTexts = [...new Set(texts)];
        const originalToIndex = new Map();
        
        // 원본 인덱스 매핑 저장
        texts.forEach((text, index) => {
          if (!originalToIndex.has(text)) {
            originalToIndex.set(text, []);
          }
          originalToIndex.get(text).push(index);
        });
        
        console.log(`[번역 익스텐션] 중복 제거 후 번역할 고유 텍스트: ${uniqueTexts.length}개`);
        
        // 배치로 나누기
        const batches = [];
        for (let i = 0; i < uniqueTexts.length; i += batchSize) {
          batches.push(uniqueTexts.slice(i, i + batchSize));
        }
        
        console.log(`[번역 익스텐션] 총 ${batches.length}개 배치로 처리`);
        
        // 번역 결과를 담을 배열
        const results = new Array(texts.length);
        
        // 이벤트 발생 (번역 시작)
        window.dispatchEvent(new CustomEvent('translation:start', {
          detail: { total: uniqueTexts.length, batches: batches.length }
        }));
        
        // 배치 번역 처리
        let completedBatches = 0;
        
        for (let i = 0; i < batches.length; i += maxConcurrent) {
          const currentBatches = batches.slice(i, i + maxConcurrent);
          
          // 병렬로 배치 처리
          const batchResults = await Promise.all(
            currentBatches.map(async batch => {
              const result = await translateWithCache(batch);
              
              completedBatches++;
              
              // 이벤트 발생 (배치 완료)
              window.dispatchEvent(new CustomEvent('translation:batch-complete', {
                detail: { 
                  completed: completedBatches, 
                  total: batches.length,
                  cachedCount: result.cachedTranslations.length,
                  newCount: result.newTranslations.length
                }
              }));
              
              return [...result.cachedTranslations, ...result.newTranslations];
            })
          );
          
          // 결과 매핑
          batchResults.flat().forEach(item => {
            const indices = originalToIndex.get(item.original);
            if (indices) {
              indices.forEach(index => {
                results[index] = item;
              });
            }
          });
        }
        
        // 이벤트 발생 (번역 완료)
        window.dispatchEvent(new CustomEvent('translation:complete', {
          detail: { total: results.length }
        }));
        
        return results;
      } catch (error) {
        // 이벤트 발생 (번역 오류)
        window.dispatchEvent(new CustomEvent('translation:error', {
          detail: { error: error.message }
        }));
        
        throw error;
      }
    }
    
    /**
     * 설정 업데이트
     * @param {Object} newSettings - 새 설정 값
     */
    function updateSettings(newSettings) {
      settings = { ...settings, ...newSettings };
    }
    
    /**
     * 현재 설정 가져오기
     * @returns {Object} - 현재 설정
     */
    function getSettings() {
      return { ...settings };
    }
    
    // 공개 API
    return {
      translateTexts,
      translateWithCache,
      translateInBatches,
      updateSettings,
      getSettings
    };
  })();
  
  // 모듈 내보내기
  window.TranslatorService = TranslatorService;