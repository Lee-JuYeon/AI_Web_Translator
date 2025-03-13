// batch_engine.js - 효율적인 배치 처리 엔진

const BatchEngine = (function() {
    'use strict';
    
    // 기본 설정
    const DEFAULT_SETTINGS = {
      batchSize: 40,              // 배치당 최대 항목 수
      maxConcurrentBatches: 3,    // 최대 동시 실행 배치 수
      retryCount: 2,              // 실패 시 재시도 횟수
      retryDelay: 1000,           // 재시도 간 지연 시간(ms)
      priorityThreshold: 0.9,     // 우선순위 기준 (0.9 = 상위 90%)
      useCache: true,             // 캐시 사용 여부
      autoDeduplication: true,    // 자동 중복 제거 여부
      progressInterval: 500,      // 진행 상태 업데이트 간격(ms)
      abortOnError: false,        // 오류 발생 시 중단 여부
      timeout: 30000              // 배치 처리 타임아웃(ms)
    };
    
    // 현재 설정
    let settings = {...DEFAULT_SETTINGS};
    
    // 배치 엔진 상태
    const state = {
      isProcessing: false,        // 처리 중 상태
      activeBatches: 0,           // 현재 활성 배치 수
      totalProcessed: 0,          // 총 처리된 항목 수
      totalItems: 0,              // 총 처리할 항목 수
      failedItems: [],            // 실패한 항목들
      startTime: 0,               // 처리 시작 시간
      batchesCompleted: 0,        // 완료된 배치 수
      processQueue: [],           // 처리 대기열
      cachedResults: new Map(),   // 캐시된 결과
      lastUpdateTime: 0,          // 마지막 상태 업데이트 시간
      itemProcessor: null,        // 항목 처리 함수
      onBatchComplete: null,      // 배치 완료 콜백
      onAllComplete: null,        // 모든 처리 완료 콜백
      onError: null,              // 오류 발생 콜백
      onProgress: null,           // 진행 상태 콜백
      abortController: null,      // 중단 컨트롤러
      originalToProcessedMap: null // 원본 항목에서 처리된 항목으로의 매핑
    };
    
    /**
     * 항목 처리 함수 설정
     * @param {Function} processorFn - 항목을 처리하는 함수 (Promise 반환)
     */
    function setItemProcessor(processorFn) {
      if (typeof processorFn !== 'function') {
        throw new Error('항목 처리 함수는 함수여야 합니다.');
      }
      state.itemProcessor = processorFn;
    }
    
    /**
     * 배치 처리 완료 콜백 설정
     * @param {Function} callbackFn - 배치 완료 시 호출될 콜백 함수
     */
    function onBatchComplete(callbackFn) {
      if (typeof callbackFn === 'function') {
        state.onBatchComplete = callbackFn;
      }
    }
    
    /**
     * 모든 처리 완료 콜백 설정
     * @param {Function} callbackFn - 모든 처리 완료 시 호출될 콜백 함수
     */
    function onAllComplete(callbackFn) {
      if (typeof callbackFn === 'function') {
        state.onAllComplete = callbackFn;
      }
    }
    
    /**
     * 오류 발생 콜백 설정
     * @param {Function} callbackFn - 오류 발생 시 호출될 콜백 함수
     */
    function onError(callbackFn) {
      if (typeof callbackFn === 'function') {
        state.onError = callbackFn;
      }
    }
    
    /**
     * 진행 상태 콜백 설정
     * @param {Function} callbackFn - 진행 상태 업데이트 시 호출될 콜백 함수
     */
    function onProgress(callbackFn) {
      if (typeof callbackFn === 'function') {
        state.onProgress = callbackFn;
      }
    }
    
    /**
     * 진행 상태 업데이트
     * @private
     */
    function updateProgress() {
      const now = Date.now();
      
      // 업데이트 간격 확인 (너무 빈번한 업데이트 방지)
      if (now - state.lastUpdateTime < settings.progressInterval) {
        return;
      }
      
      state.lastUpdateTime = now;
      
      // 진행률 계산
      const progress = {
        processed: state.totalProcessed,
        total: state.totalItems,
        percentage: Math.min(100, Math.round((state.totalProcessed / state.totalItems) * 100)),
        elapsed: now - state.startTime,
        batchesCompleted: state.batchesCompleted,
        activeBatches: state.activeBatches,
        failedCount: state.failedItems.length
      };
      
      // 콜백 호출
      if (state.onProgress) {
        state.onProgress(progress);
      }
      
      // 이벤트 발생
      if (window.dispatchEvent) {
        try {
          window.dispatchEvent(new CustomEvent('batchengine:progress', {
            detail: { progress }
          }));
        } catch (error) {
          console.warn('[번역 익스텐션] 진행 상태 이벤트 발행 오류:', error);
        }
      }
    }
    
    /**
     * 배치 처리 시작
     * @param {Array} items - 처리할 항목 배열
     * @param {Object} options - 처리 옵션
     * @returns {Promise<Array>} - 처리 결과 Promise
     */
    function processBatches(items, options = {}) {
      return new Promise(async (resolve, reject) => {
        try {
          // 처리 옵션
          const processingOptions = {
            ...settings,
            ...options
          };
          
          // 항목 처리 함수 확인
          if (!state.itemProcessor || typeof state.itemProcessor !== 'function') {
            throw new Error('항목 처리 함수가 설정되지 않았습니다.');
          }
          
          // 이미 처리 중인 경우
          if (state.isProcessing) {
            throw new Error('이미 배치 처리가 진행 중입니다.');
          }
          
          // 유효한 항목 확인
          if (!Array.isArray(items) || items.length === 0) {
            console.warn('[번역 익스텐션] 처리할 항목이 없습니다.');
            resolve([]);
            return;
          }
          
          // 상태 초기화
          state.isProcessing = true;
          state.activeBatches = 0;
          state.totalProcessed = 0;
          state.failedItems = [];
          state.batchesCompleted = 0;
          state.startTime = Date.now();
          state.lastUpdateTime = Date.now();
          state.abortController = new AbortController();
          
          // 중단 신호 확인 함수
          const isAborted = () => state.abortController.signal.aborted;
          
          // 입력 항목 중복 제거 (필요 시)
          let processItems = items;
          state.originalToProcessedMap = new Map();
          
          if (processingOptions.autoDeduplication) {
            const uniqueMap = new Map();
            
            // 원본 인덱스 매핑
            items.forEach((item, index) => {
              // item이 객체인 경우 JSON으로 변환하여 키로 사용
              const key = typeof item === 'object' ? 
                JSON.stringify(item) : String(item);
              
              if (!uniqueMap.has(key)) {
                uniqueMap.set(key, {
                  item: item,
                  indices: []
                });
              }
              uniqueMap.get(key).indices.push(index);
            });
            
            // 중복 제거된 항목 배열
            const uniqueItems = [];
            
            // 매핑 설정
            uniqueMap.forEach((info) => {
              const uniqueIndex = uniqueItems.length;
              uniqueItems.push(info.item);
              
              // 각 원본 인덱스에 중복 제거된 인덱스 매핑
              info.indices.forEach(originalIndex => {
                state.originalToProcessedMap.set(originalIndex, uniqueIndex);
              });
            });
            
            processItems = uniqueItems;
            console.log(`[번역 익스텐션] 중복 제거: ${items.length} → ${processItems.length}`);
          } else {
            // 중복 제거를 사용하지 않는 경우 1:1 매핑
            items.forEach((_, index) => {
              state.originalToProcessedMap.set(index, index);
            });
          }
          
          state.totalItems = processItems.length;
          
          // 배치로 나누기
          const batches = [];
          for (let i = 0; i < processItems.length; i += processingOptions.batchSize) {
            batches.push(processItems.slice(i, i + processingOptions.batchSize));
          }
          
          console.log(`[번역 익스텐션] 총 ${batches.length}개 배치로 처리 (항목 ${processItems.length}개)`);
          
          // 진행 상태 이벤트 발생
          if (window.dispatchEvent) {
            try {
              window.dispatchEvent(new CustomEvent('batchengine:start', {
                detail: { 
                  total: processItems.length,
                  batches: batches.length
                }
              }));
            } catch (error) {
              console.warn('[번역 익스텐션] 시작 이벤트 발행 오류:', error);
            }
          }
          
          // 결과 저장 배열 (처리된 항목 배열 크기로 초기화)
          const processedResults = new Array(processItems.length);
          
          // 배치 처리 함수
          const processBatch = async (batch, batchIndex) => {
            try {
              // 중단 확인
              if (isAborted()) {
                return [];
              }
              
              state.activeBatches++;
              
              const startTime = Date.now();
              let batchResults = [];
              
              try {
                // 배치 항목 처리
                batchResults = await Promise.all(
                  batch.map(async (item, itemIndex) => {
                    // 중단 확인
                    if (isAborted()) {
                      return null;
                    }
                    
                    // 전체 배치 인덱스
                    const globalItemIndex = batchIndex * processingOptions.batchSize + itemIndex;
                    
                    // 캐시 확인 (캐시 사용이 활성화된 경우)
                    if (processingOptions.useCache) {
                      const itemKey = typeof item === 'object' ? 
                        JSON.stringify(item) : String(item);
                      
                      if (state.cachedResults.has(itemKey)) {
                        return state.cachedResults.get(itemKey);
                      }
                    }
                    
                    // 처리 시도
                    let result = null;
                    let retryCount = 0;
                    let lastError = null;
                    
                    // 재시도 로직
                    while (retryCount <= processingOptions.retryCount) {
                      try {
                        // 중단 확인
                        if (isAborted()) {
                          return null;
                        }
                        
                        // 항목 처리
                        result = await Promise.race([
                          state.itemProcessor(item, globalItemIndex),
                          // 타임아웃 처리
                          new Promise((_, timeoutReject) => 
                            setTimeout(() => timeoutReject(new Error('항목 처리 타임아웃')), 
                              processingOptions.timeout)
                          )
                        ]);
                        
                        // 성공한 경우
                        break;
                      } catch (error) {
                        lastError = error;
                        retryCount++;
                        
                        // 마지막 시도가 아니라면 재시도
                        if (retryCount <= processingOptions.retryCount) {
                          console.warn(`[번역 익스텐션] 항목 처리 오류, ${retryCount}번째 재시도 중:`, error);
                          
                          // 재시도 전 지연
                          await new Promise(r => setTimeout(r, 
                            processingOptions.retryDelay * Math.pow(2, retryCount - 1)));
                        }
                      }
                    }
                    
                    // 모든 시도 실패
                    if (retryCount > processingOptions.retryCount) {
                      state.failedItems.push({ item, error: lastError });
                      
                      // 오류 콜백 호출
                      if (state.onError) {
                        state.onError(lastError, item, batchIndex, globalItemIndex);
                      }
                      
                      return null;
                    }
                    
                    // 캐시에 결과 저장
                    if (processingOptions.useCache && result !== null) {
                      const itemKey = typeof item === 'object' ? 
                        JSON.stringify(item) : String(item);
                      state.cachedResults.set(itemKey, result);
                    }
                    
                    return result;
                  })
                );
              } catch (batchError) {
                console.error(`[번역 익스텐션] 배치 ${batchIndex} 처리 중 오류:`, batchError);
                
                // 오류 콜백 호출
                if (state.onError) {
                  state.onError(batchError, null, batchIndex);
                }
                
                // 오류 발생 시 중단 옵션 확인
                if (processingOptions.abortOnError) {
                  throw batchError;
                }
                
                // 오류 발생해도 계속 진행하는 경우 빈 결과 반환
                batchResults = new Array(batch.length).fill(null);
              }
              
              // 배치 결과 저장
              batchResults.forEach((result, i) => {
                const globalIndex = batchIndex * processingOptions.batchSize + i;
                if (globalIndex < processedResults.length) {
                  processedResults[globalIndex] = result;
                }
              });
              
              state.activeBatches--;
              state.batchesCompleted++;
              state.totalProcessed += batch.length;
              
              const elapsedTime = Date.now() - startTime;
              
              // 배치 완료 콜백 호출
              if (state.onBatchComplete && !isAborted()) {
                state.onBatchComplete({
                  results: batchResults,
                  batchIndex,
                  items: batch,
                  elapsedTime
                });
              }
              
              // 이벤트 발생
              if (window.dispatchEvent && !isAborted()) {
                try {
                  window.dispatchEvent(new CustomEvent('batchengine:batch-complete', {
                    detail: { 
                      batchIndex,
                      batchSize: batch.length,
                      elapsedTime,
                      completed: state.batchesCompleted,
                      total: batches.length
                    }
                  }));
                } catch (error) {
                  console.warn('[번역 익스텐션] 배치 완료 이벤트 발행 오류:', error);
                }
              }
              
              // 진행 상태 업데이트
              updateProgress();
              
              return batchResults;
            } catch (error) {
              state.activeBatches--;
              console.error(`[번역 익스텐션] 배치 ${batchIndex} 처리 오류:`, error);
              throw error;
            }
          };
          
          // 배치 배열 처리
          const processBatchGroups = async () => {
            try {
              for (let i = 0; i < batches.length; i += processingOptions.maxConcurrentBatches) {
                // 중단 확인
                if (isAborted()) {
                  console.log('[번역 익스텐션] 배치 처리가 중단되었습니다.');
                  break;
                }
                
                // 동시에 처리할 배치들
                const currentBatches = batches.slice(i, i + processingOptions.maxConcurrentBatches);
                
                // 병렬 처리
                try {
                  await Promise.all(
                    currentBatches.map((batch, index) => 
                      processBatch(batch, i + index)
                    )
                  );
                } catch (error) {
                  console.error('[번역 익스텐션] 배치 그룹 처리 중 오류:', error);
                  
                  // 오류 발생 시 중단 옵션 확인
                  if (processingOptions.abortOnError) {
                    state.abortController.abort();
                    break;
                  }
                  
                  // 계속 진행
                }
                
                // 중단 확인
                if (isAborted()) {
                  console.log('[번역 익스텐션] 배치 처리가 중단되었습니다.');
                  break;
                }
              }
            } catch (error) {
              console.error('[번역 익스텐션] 배치 그룹 처리 오류:', error);
              throw error;
            }
          };
          
          try {
            // 모든 배치 처리 시작
            await processBatchGroups();
            
            // 원본 결과 배열 (원본 항목 배열 크기로 초기화)
            const originalResults = new Array(items.length);
            
            // 원본 인덱스에 결과 매핑
            for (let i = 0; i < items.length; i++) {
              const processedIndex = state.originalToProcessedMap.get(i);
              if (processedIndex !== undefined && processedResults[processedIndex] !== undefined) {
                originalResults[i] = processedResults[processedIndex];
              } else {
                originalResults[i] = null;
              }
            }
            
            // 처리 완료
            state.isProcessing = false;
            
            // 완료 시간 계산
            const totalTime = Date.now() - state.startTime;
            
            const summary = {
              totalItems: items.length,
              processedItems: processItems.length,
              successCount: processedResults.filter(r => r !== null).length,
              failedCount: state.failedItems.length,
              elapsedTime: totalTime,
              itemsPerSecond: Math.round((items.length / totalTime) * 1000)
            };
            
            console.log(`[번역 익스텐션] 배치 처리 완료 (${totalTime}ms, ${summary.itemsPerSecond}항목/초)`);
            
            // 완료 콜백 호출
            if (state.onAllComplete && !isAborted()) {
              state.onAllComplete({
                results: originalResults,
                summary
              });
            }
            
            // 완료 이벤트 발생
            if (window.dispatchEvent && !isAborted()) {
              try {
                window.dispatchEvent(new CustomEvent('batchengine:complete', {
                  detail: { summary }
                }));
              } catch (error) {
                console.warn('[번역 익스텐션] 완료 이벤트 발행 오류:', error);
              }
            }
            
            // 결과 반환
            resolve(originalResults);
          } catch (processError) {
            // 처리 실패
            state.isProcessing = false;
            
            console.error('[번역 익스텐션] 배치 처리 실패:', processError);
            
            // 오류 이벤트 발생
            if (window.dispatchEvent) {
              try {
                window.dispatchEvent(new CustomEvent('batchengine:error', {
                  detail: { 
                    error: processError,
                    processed: state.totalProcessed,
                    total: state.totalItems
                  }
                }));
              } catch (eventError) {
                console.warn('[번역 익스텐션] 오류 이벤트 발행 오류:', eventError);
              }
            }
            
            reject(processError);
          }
        } catch (error) {
          // 초기화 실패
          state.isProcessing = false;
          console.error('[번역 익스텐션] 배치 처리 초기화 오류:', error);
          reject(error);
        }
      });
    }
    
    /**
     * 현재 처리 중인 작업 중단
     * @returns {boolean} - 중단 성공 여부
     */
    function abort() {
      if (!state.isProcessing || !state.abortController) {
        return false;
      }
      
      try {
        state.abortController.abort();
        console.log('[번역 익스텐션] 배치 처리 중단 요청됨');
        
        // 중단 이벤트 발생
        if (window.dispatchEvent) {
          try {
            window.dispatchEvent(new CustomEvent('batchengine:aborted', {
              detail: { 
                processed: state.totalProcessed,
                total: state.totalItems
              }
            }));
          } catch (error) {
            console.warn('[번역 익스텐션] 중단 이벤트 발행 오류:', error);
          }
        }
        
        return true;
      } catch (error) {
        console.error('[번역 익스텐션] 배치 처리 중단 오류:', error);
        return false;
      }
    }
    
    /**
     * 현재 처리 상태 가져오기
     * @returns {Object} - 현재 상태
     */
    function getStatus() {
      return {
        isProcessing: state.isProcessing,
        totalProcessed: state.totalProcessed,
        totalItems: state.totalItems,
        percentage: state.totalItems > 0 ? 
          Math.min(100, Math.round((state.totalProcessed / state.totalItems) * 100)) : 0,
        elapsed: state.startTime > 0 ? Date.now() - state.startTime : 0,
        batchesCompleted: state.batchesCompleted,
        activeBatches: state.activeBatches,
        failedCount: state.failedItems.length,
        cacheSize: state.cachedResults.size
      };
    }
    
    /**
     * 캐시 초기화
     */
    function clearCache() {
      state.cachedResults.clear();
      console.log('[번역 익스텐션] 배치 처리 캐시 초기화됨');
      return true;
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
    
    // 공개 API
    return {
      processBatches,
      setItemProcessor,
      onBatchComplete,
      onAllComplete,
      onError,
      onProgress,
      abort,
      getStatus,
      clearCache,
      updateSettings,
      getSettings
    };
  })();
  
  // 모듈 내보내기
  window.BatchEngine = BatchEngine;