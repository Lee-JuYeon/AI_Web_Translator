// batch_engine.js - TonyConfig 활용 리팩토링 버전
const BatchEngine = (function() {
    'use strict';
    
    // 기본 설정 (TonyConfig에서 가져옴)
    const DEFAULT_SETTINGS = {
      batchSize: TonyConfig.APP_CONFIG.defaultSettings.batchSize || 40,
      maxConcurrentBatches: TonyConfig.APP_CONFIG.defaultSettings.maxConcurrentBatches || 3,
      retryCount: 2,
      retryDelay: 1000,
      priorityThreshold: 0.9,
      useCache: true,
      autoDeduplication: true,
      progressInterval: 500,
      abortOnError: false,
      timeout: 30000
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
        percentage: calculatePercentage(state.totalProcessed, state.totalItems),
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
      dispatchProgressEvent(progress);
    }
    
    /**
     * 백분율 계산 (0-100)
     * @param {number} value - 현재 값
     * @param {number} total - 전체 값
     * @returns {number} - 백분율
     */
    function calculatePercentage(value, total) {
      if (!total) return 0;
      return Math.min(100, Math.round((value / total) * 100));
    }
    
    /**
     * 진행 상태 이벤트 발행
     * @param {Object} progress - 진행 상태 객체
     */
    function dispatchProgressEvent(progress) {
      try {
        TonyConfig.safeDispatchEvent('batchengine:progress', { progress });
      } catch (error) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] 진행 상태 이벤트 발행 오류:`, error);
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
          
          // 유효성 검사 및 초기화
          if (!validateProcessingRequest(items)) {
            resolve([]);
            return;
          }
          
          // 상태 초기화
          initializeProcessingState();
          
          // 중단 신호 확인 함수
          const isAborted = () => state.abortController.signal.aborted;
          
          // 입력 항목 중복 제거 (필요 시)
          const processItems = deduplicateItems(items, processingOptions);
          
          // 배치로 나누기 및 처리 시작
          const batches = createBatches(processItems, processingOptions.batchSize);
          
          console.log(`[${TonyConfig.APP_CONFIG.appName}] 총 ${batches.length}개 배치로 처리 (항목 ${processItems.length}개)`);
          
          // 처리 시작 이벤트 발행
          dispatchStartEvent(processItems.length, batches.length);
          
          // 결과 저장 배열 (처리된 항목 배열 크기로 초기화)
          const processedResults = new Array(processItems.length);
          
          try {
            // 배치 그룹 처리 시작
            await processBatchGroups(batches, processedResults, processingOptions, isAborted);
            
            // 원본 인덱스에 결과 매핑 및 결과 반환
            const originalResults = mapResultsToOriginalIndices(items, processedResults);
            
            // 처리 완료
            finishProcessing(originalResults, items.length);
            
            resolve(originalResults);
          } catch (processError) {
            // 처리 실패
            handleProcessingError(processError, reject);
          }
        } catch (error) {
          // 초기화 실패
          handleInitializationError(error, reject);
        }
      });
    }
    
    /**
     * 처리 요청 유효성 검사
     * @param {Array} items - 처리할 항목 배열
     * @returns {boolean} - 유효한 요청인지 여부
     */
    function validateProcessingRequest(items) {
      // 항목 처리 함수 확인
      if (!state.itemProcessor || typeof state.itemProcessor !== 'function') {
        console.error(`[${TonyConfig.APP_CONFIG.appName}] 항목 처리 함수가 설정되지 않았습니다.`);
        return false;
      }
      
      // 이미 처리 중인 경우
      if (state.isProcessing) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] 이미 배치 처리가 진행 중입니다.`);
        return false;
      }
      
      // 유효한 항목 확인
      if (!Array.isArray(items) || items.length === 0) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] 처리할 항목이 없습니다.`);
        return false;
      }
      
      return true;
    }
    
    /**
     * 처리 상태 초기화
     */
    function initializeProcessingState() {
      state.isProcessing = true;
      state.activeBatches = 0;
      state.totalProcessed = 0;
      state.failedItems = [];
      state.batchesCompleted = 0;
      state.startTime = Date.now();
      state.lastUpdateTime = Date.now();
      state.abortController = new AbortController();
    }
    
    /**
     * 항목 중복 제거
     * @param {Array} items - 원본 항목 배열
     * @param {Object} options - 처리 옵션
     * @returns {Array} - 중복 제거된 항목 배열
     */
    function deduplicateItems(items, options) {
      state.originalToProcessedMap = new Map();
      
      // 중복 제거 옵션이 비활성화된 경우
      if (!options.autoDeduplication) {
        // 1:1 매핑
        items.forEach((_, index) => {
          state.originalToProcessedMap.set(index, index);
        });
        return items;
      }
      
      // 중복 제거 처리
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
      
      console.log(`[${TonyConfig.APP_CONFIG.appName}] 중복 제거: ${items.length} → ${uniqueItems.length}`);
      
      state.totalItems = uniqueItems.length;
      return uniqueItems;
    }
    
    /**
     * 항목 배열을 배치로 나누기
     * @param {Array} items - 처리할 항목 배열
     * @param {number} batchSize - 배치 크기
     * @returns {Array} - 배치 배열
     */
    function createBatches(items, batchSize) {
      const batches = [];
      for (let i = 0; i < items.length; i += batchSize) {
        batches.push(items.slice(i, i + batchSize));
      }
      return batches;
    }
    
    /**
     * 처리 시작 이벤트 발행
     * @param {number} totalItems - 총 항목 수
     * @param {number} batchCount - 배치 수
     */
    function dispatchStartEvent(totalItems, batchCount) {
      try {
        TonyConfig.safeDispatchEvent('batchengine:start', {
          total: totalItems,
          batches: batchCount
        });
      } catch (error) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] 시작 이벤트 발행 오류:`, error);
      }
    }
    
    /**
     * 배치 그룹 처리
     * @param {Array} batches - 배치 배열
     * @param {Array} processedResults - 처리 결과 배열
     * @param {Object} options - 처리 옵션
     * @param {Function} isAborted - 중단 확인 함수
     * @returns {Promise<void>} - 처리 완료 Promise
     */
    async function processBatchGroups(batches, processedResults, options, isAborted) {
      for (let i = 0; i < batches.length; i += options.maxConcurrentBatches) {
        // 중단 확인
        if (isAborted()) {
          console.log(`[${TonyConfig.APP_CONFIG.appName}] 배치 처리가 중단되었습니다.`);
          break;
        }
        
        // 동시에 처리할 배치들
        const currentBatches = batches.slice(i, i + options.maxConcurrentBatches);
        
        try {
          // 병렬 처리
          await Promise.all(
            currentBatches.map((batch, index) => 
              processBatch(batch, i + index, processedResults, options, isAborted)
            )
          );
        } catch (error) {
          console.error(`[${TonyConfig.APP_CONFIG.appName}] 배치 그룹 처리 중 오류:`, error);
          
          // 오류 발생 시 중단 옵션 확인
          if (options.abortOnError) {
            state.abortController.abort();
            break;
          }
          // 계속 진행
        }
        
        // 중단 확인
        if (isAborted()) {
          console.log(`[${TonyConfig.APP_CONFIG.appName}] 배치 처리가 중단되었습니다.`);
          break;
        }
      }
    }
    
    /**
     * 단일 배치 처리
     * @param {Array} batch - 처리할 배치
     * @param {number} batchIndex - 배치 인덱스
     * @param {Array} processedResults - 처리 결과 배열
     * @param {Object} options - 처리 옵션
     * @param {Function} isAborted - 중단 확인 함수
     * @returns {Promise<Array>} - 배치 처리 결과
     */
    async function processBatch(batch, batchIndex, processedResults, options, isAborted) {
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
          batchResults = await processBatchItems(batch, batchIndex, options, isAborted);
          
          // 배치 결과 저장
          saveBatchResults(batchResults, batchIndex, options.batchSize, processedResults);
          
          // 상태 업데이트
          updateStateAfterBatchComplete(batch);
          
          // 배치 완료 처리
          handleBatchCompletion(batchResults, batch, batchIndex, startTime, isAborted);
          
          return batchResults;
        } catch (error) {
          // 배치 오류 처리
          handleBatchError(error, batch, batchIndex, processedResults);
          
          // 오류 발생해도 계속 진행하는 경우 빈 결과 반환
          return new Array(batch.length).fill(null);
        }
      } catch (error) {
        state.activeBatches--;
        console.error(`[${TonyConfig.APP_CONFIG.appName}] 배치 ${batchIndex} 처리 오류:`, error);
        throw error;
      }
    }
    
    /**
     * 배치 항목 처리
     * @param {Array} batch - 처리할 배치
     * @param {number} batchIndex - 배치 인덱스
     * @param {Object} options - 처리 옵션
     * @param {Function} isAborted - 중단 확인 함수
     * @returns {Promise<Array>} - 배치 항목 처리 결과
     */
    async function processBatchItems(batch, batchIndex, options, isAborted) {
      return await Promise.all(
        batch.map(async (item, itemIndex) => {
          // 중단 확인
          if (isAborted()) {
            return null;
          }
          
          // 전체 배치 인덱스
          const globalItemIndex = batchIndex * options.batchSize + itemIndex;
          
          // 캐시 확인 (캐시 사용이 활성화된 경우)
          if (options.useCache) {
            const cachedResult = checkCache(item);
            if (cachedResult !== undefined) {
              return cachedResult;
            }
          }
          
          return await processItemWithRetry(item, globalItemIndex, options);
        })
      );
    }
    
    /**
     * 캐시에서 항목 결과 확인
     * @param {*} item - 처리할 항목
     * @returns {*} - 캐시된 결과 또는 undefined
     */
    function checkCache(item) {
      const itemKey = typeof item === 'object' ? 
        JSON.stringify(item) : String(item);
      
      return state.cachedResults.has(itemKey) ? 
        state.cachedResults.get(itemKey) : undefined;
    }
    
    /**
     * 재시도 로직이 포함된 항목 처리
     * @param {*} item - 처리할 항목
     * @param {number} globalItemIndex - 전체 배치 내 인덱스
     * @param {Object} options - 처리 옵션
     * @returns {Promise<*>} - 처리 결과
     */
    async function processItemWithRetry(item, globalItemIndex, options) {
      let retryCount = 0;
      let lastError = null;
      
      // 재시도 로직
      while (retryCount <= options.retryCount) {
        try {
          // 항목 처리
          const result = await Promise.race([
            state.itemProcessor(item, globalItemIndex),
            // 타임아웃 처리
            new Promise((_, timeoutReject) => 
              setTimeout(() => timeoutReject(new Error('항목 처리 타임아웃')), 
                options.timeout)
            )
          ]);
          
          // 캐시에 결과 저장
          saveToCache(item, result);
          
          return result;
        } catch (error) {
          lastError = error;
          retryCount++;
          
          // 마지막 시도가 아니라면 재시도
          if (retryCount <= options.retryCount) {
            console.warn(`[${TonyConfig.APP_CONFIG.appName}] 항목 처리 오류, ${retryCount}번째 재시도 중:`, error);
            
            // 지수 백오프 (재시도 횟수에 따라 대기 시간 증가)
            const delay = options.retryDelay * Math.pow(2, retryCount - 1);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }
      
      // 모든 시도 실패
      handleItemFailure(item, lastError, globalItemIndex);
      return null;
    }
    
    /**
     * 캐시에 결과 저장
     * @param {*} item - 처리한 항목
     * @param {*} result - 처리 결과
     */
    function saveToCache(item, result) {
      if (result !== null) {
        const itemKey = typeof item === 'object' ? 
          JSON.stringify(item) : String(item);
        state.cachedResults.set(itemKey, result);
      }
    }
    
    /**
     * 항목 처리 실패 핸들링
     * @param {*} item - 실패한 항목
     * @param {Error} error - 발생한 오류
     * @param {number} itemIndex - 항목 인덱스
     */
    function handleItemFailure(item, error, itemIndex) {
      state.failedItems.push({ item, error });
      
      // 오류 콜백 호출
      if (state.onError) {
        state.onError(error, item, null, itemIndex);
      }
    }
    
    /**
     * 배치 결과 저장
     * @param {Array} results - 배치 처리 결과
     * @param {number} batchIndex - 배치 인덱스
     * @param {number} batchSize - 배치 크기
     * @param {Array} processedResults - 전체 처리 결과 배열
     */
    function saveBatchResults(results, batchIndex, batchSize, processedResults) {
      results.forEach((result, i) => {
        const globalIndex = batchIndex * batchSize + i;
        if (globalIndex < processedResults.length) {
          processedResults[globalIndex] = result;
        }
      });
    }
    
    /**
     * 배치 완료 후 상태 업데이트
     * @param {Array} batch - 처리한 배치
     */
    function updateStateAfterBatchComplete(batch) {
      state.activeBatches--;
      state.batchesCompleted++;
      state.totalProcessed += batch.length;
      
      // 진행 상태 업데이트
      updateProgress();
    }
    
    /**
     * 배치 완료 처리
     * @param {Array} results - 배치 처리 결과
     * @param {Array} batch - 처리한 배치
     * @param {number} batchIndex - 배치 인덱스
     * @param {number} startTime - 처리 시작 시간
     * @param {Function} isAborted - 중단 확인 함수
     */
    function handleBatchCompletion(results, batch, batchIndex, startTime, isAborted) {
      const elapsedTime = Date.now() - startTime;
      
      // 배치 완료 콜백 호출
      if (state.onBatchComplete && !isAborted()) {
        state.onBatchComplete({
          results: results,
          batchIndex,
          items: batch,
          elapsedTime
        });
      }
      
      // 이벤트 발생
      if (!isAborted()) {
        try {
          TonyConfig.safeDispatchEvent('batchengine:batch-complete', {
            batchIndex,
            batchSize: batch.length,
            elapsedTime,
            completed: state.batchesCompleted,
            total: state.totalItems / batch.length
          });
        } catch (error) {
          console.warn(`[${TonyConfig.APP_CONFIG.appName}] 배치 완료 이벤트 발행 오류:`, error);
        }
      }
    }
    
    /**
     * 배치 오류 처리
     * @param {Error} error - 발생한 오류
     * @param {Array} batch - 처리 중이던 배치
     * @param {number} batchIndex - 배치 인덱스
     * @param {Array} processedResults - 전체 처리 결과 배열
     */
    function handleBatchError(error, batch, batchIndex, processedResults) {
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 배치 ${batchIndex} 처리 중 오류:`, error);
      
      // 오류 콜백 호출
      if (state.onError) {
        state.onError(error, null, batchIndex);
      }
      
      // 빈 결과로 채움
      batch.forEach((_, i) => {
        const globalIndex = batchIndex * settings.batchSize + i;
        if (globalIndex < processedResults.length) {
          processedResults[globalIndex] = null;
        }
      });
      
      state.activeBatches--;
      state.batchesCompleted++;
      state.totalProcessed += batch.length;
    }
    
    /**
     * 원본 인덱스에 결과 매핑
     * @param {Array} items - 원본 항목 배열
     * @param {Array} processedResults - 처리 결과 배열
     * @returns {Array} - 원본 인덱스 순서로 매핑된 결과
     */
    function mapResultsToOriginalIndices(items, processedResults) {
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
      
      return originalResults;
    }
    
    /**
     * 처리 완료 처리
     * @param {Array} results - 처리 결과
     * @param {number} totalOriginalItems - 원본 항목 총 개수
     */
    function finishProcessing(results, totalOriginalItems) {
      // 처리 완료
      state.isProcessing = false;
      
      // 완료 시간 계산
      const totalTime = Date.now() - state.startTime;
      
      // 처리 요약 정보
      const summary = createProcessingSummary(results, totalOriginalItems, totalTime);
      
      console.log(`[${TonyConfig.APP_CONFIG.appName}] 배치 처리 완료 (${totalTime}ms, ${summary.itemsPerSecond}항목/초)`);
      
      // 완료 콜백 호출
      if (state.onAllComplete) {
        state.onAllComplete({
          results: results,
          summary
        });
      }
      
      // 완료 이벤트 발행
      dispatchCompleteEvent(summary);
    }
    
    /**
     * 처리 요약 정보 생성
     * @param {Array} results - 처리 결과
     * @param {number} totalItems - 총 항목 수
     * @param {number} totalTime - 총 처리 시간
     * @returns {Object} - 처리 요약 정보
     */
    function createProcessingSummary(results, totalItems, totalTime) {
      return {
        totalItems: totalItems,
        processedItems: state.totalItems,
        successCount: results.filter(r => r !== null).length,
        failedCount: state.failedItems.length,
        elapsedTime: totalTime,
        itemsPerSecond: Math.round((totalItems / totalTime) * 1000)
      };
    }
    
    /**
     * 완료 이벤트 발행
     * @param {Object} summary - 처리 요약 정보
     */
    function dispatchCompleteEvent(summary) {
      try {
        TonyConfig.safeDispatchEvent('batchengine:complete', { summary });
      } catch (error) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] 완료 이벤트 발행 오류:`, error);
      }
    }
    
    /**
     * 처리 오류 처리
     * @param {Error} error - 발생한 오류
     * @param {Function} reject - Promise reject 함수
     */
    function handleProcessingError(error, reject) {
      state.isProcessing = false;
      
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 배치 처리 실패:`, error);
      
      // 오류 이벤트 발행
      try {
        TonyConfig.safeDispatchEvent('batchengine:error', {
          error: error,
          processed: state.totalProcessed,
          total: state.totalItems
        });
      } catch (eventError) {
        console.warn(`[${TonyConfig.APP_CONFIG.appName}] 오류 이벤트 발행 오류:`, eventError);
      }
      
      reject(error);
    }
    
    /**
     * 초기화 오류 처리
     * @param {Error} error - 발생한 오류
     * @param {Function} reject - Promise reject 함수
     */
    function handleInitializationError(error, reject) {
      state.isProcessing = false;
      console.error(`[${TonyConfig.APP_CONFIG.appName}] 배치 처리 초기화 오류:`, error);
      reject(error);
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
        console.log(`[${TonyConfig.APP_CONFIG.appName}] 배치 처리 중단 요청됨`);
        
        // 중단 이벤트 발행
        try {
          TonyConfig.safeDispatchEvent('batchengine:aborted', {
            processed: state.totalProcessed,
            total: state.totalItems
          });
        } catch (error) {
          console.warn(`[${TonyConfig.APP_CONFIG.appName}] 중단 이벤트 발행 오류:`, error);
        }
        
        return true;
      } catch (error) {
        console.error(`[${TonyConfig.APP_CONFIG.appName}] 배치 처리 중단 오류:`, error);
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
        percentage: calculatePercentage(state.totalProcessed, state.totalItems),
        elapsed: state.startTime > 0 ? Date.now() - state.startTime : 0,
        batchesCompleted: state.batchesCompleted,
        activeBatches: state.activeBatches,
        failedCount: state.failedItems.length,
        cacheSize: state.cachedResults.size
      };
    }
    
    /**
     * 캐시 초기화
     * @returns {boolean} - 성공 여부
     */
    function clearCache() {
      try {
        state.cachedResults.clear();
        console.log(`[${TonyConfig.APP_CONFIG.appName}] 배치 처리 캐시 초기화됨`);
        return true;
      } catch (error) {
        console.error(`[${TonyConfig.APP_CONFIG.appName}] 캐시 초기화 오류:`, error);
        return false;
      }
    }
    
    /**
     * 설정 업데이트
     * @param {Object} newSettings - 새 설정 값
     */
    function updateSettings(newSettings) {
      if (!newSettings) return;
      
      // 이전 설정 백업
      const oldSettings = { ...settings };
      
      // 새 설정 적용
      settings = { ...settings, ...newSettings };
      
      // 변경 사항 로깅
      logSettingsChanges(oldSettings);
    }
    
    /**
     * 설정 변경 사항 로깅
     * @param {Object} oldSettings - 이전 설정
     */
    function logSettingsChanges(oldSettings) {
      const changedSettings = {};
      
      Object.entries(settings).forEach(([key, value]) => {
        if (oldSettings[key] !== value) {
          changedSettings[key] = value;
        }
      });
      
      if (Object.keys(changedSettings).length > 0) {
        console.log(`[${TonyConfig.APP_CONFIG.appName}] BatchEngine 설정 변경:`, changedSettings);
      }
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