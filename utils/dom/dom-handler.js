// dom-handler.js - ES 모듈 방식으로 리팩토링
import { APP_CONFIG, safeDispatchEvent } from '../../config.js';
import * as DOMSelector from './dom-selector.js';
import * as DOMObserver from './dom-observer.js';
import * as DOMManipulator from './dom-manipulator.js';
import * as BatchEngine from '../batch/batch_engine.js';

// 기본 설정
const DEFAULT_SETTINGS = {
  minTextLength: APP_CONFIG.defaultSettings.minTextLength || 2,
  textContainerSelector: 'p, h1, h2, h3, h4, h5, li, span, a, td, div, article',
  ignoreSelector: 'script, style, noscript, code, pre',
  rootMargin: '500px',
  translatedAttr: APP_CONFIG.domAttributes.translatedAttr,
  pendingAttr: APP_CONFIG.domAttributes.pendingAttr,
  sourceAttr: APP_CONFIG.domAttributes.sourceAttr,
  preloadThreshold: 0.01,
  batchSize: APP_CONFIG.defaultSettings.batchSize || 40,
  maxConcurrentBatches: APP_CONFIG.defaultSettings.maxConcurrentBatches || 3,
  translateFullPage: APP_CONFIG.defaultSettings.translateFullPage,
  immediateTranslation: APP_CONFIG.defaultSettings.immediateTranslation,
  observeAllOnInit: true,
  autoRefresh: true
};

// 현재 설정
let settings = {...DEFAULT_SETTINGS};

// 상태 관리
const state = {
  isTranslating: false,
  isInitialized: false,
  refreshTimer: null,
  fullPageRequested: false,
  processingQueue: [],
  autoRefreshInterval: 5000,
  lastElementCount: 0,
  lastProcessTime: 0
};

/**
 * 모듈 의존성 확인
 * @returns {boolean} - 모든 의존성 모듈이 로드되었는지 여부
 */
function checkDependencies() {
  // 필수 모듈 리스트
  const dependencies = [
    { name: 'DOMSelector', obj: DOMSelector },
    { name: 'DOMObserver', obj: DOMObserver },
    { name: 'DOMManipulator', obj: DOMManipulator },
    { name: 'BatchEngine', obj: BatchEngine }
  ];
  
  // 모듈 존재 확인
  const missing = dependencies.filter(dep => {
    const exists = dep.obj && Object.keys(dep.obj).length > 0;
    if (!exists) {
      console.error(`[${APP_CONFIG.appName}] 필수 모듈 누락: ${dep.name}`);
    }
    return !exists;
  });
  
  if (missing.length > 0) {
    const missingNames = missing.map(dep => dep.name).join(', ');
    console.error(`[${APP_CONFIG.appName}] 필요한 모듈이 로드되지 않았습니다: ${missingNames}`);
    return false;
  }
  
  return true;
}

/**
 * 텍스트 노드 처리 준비
 * @param {Element[]} elements - 번역할 요소 배열
 * @returns {Array} - 텍스트 노드 정보 배열
 */
function prepareTextNodes(elements) {
  try {
    if (!Array.isArray(elements) || elements.length === 0) {
      return [];
    }
    
    // DOMSelector 의존성 확인
    if (!DOMSelector) {
      console.error(`[${APP_CONFIG.appName}] DOMSelector 모듈이 필요합니다.`);
      return [];
    }
    
    const allTextNodes = [];
    
    // 각 요소에서 텍스트 노드 추출
    elements.forEach(element => {
      try {
        if (element instanceof Element) {
          // 이미 번역된 요소는 건너뜀
          if (element.hasAttribute(settings.translatedAttr)) {
            return;
          }
          
          // 요소에서 텍스트 노드 추출
          const textNodes = DOMSelector.extractTextNodesFromElement(element);
          
          if (textNodes && textNodes.length > 0) {
            allTextNodes.push(...textNodes);
          }
        }
      } catch (elementError) {
        console.warn(`[${APP_CONFIG.appName}] 요소 텍스트 노드 추출 오류:`, elementError);
      }
    });
    
    console.log(`[${APP_CONFIG.appName}] ${elements.length}개 요소에서 ${allTextNodes.length}개 텍스트 노드 추출됨`);
    
    return allTextNodes;
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 텍스트 노드 준비 오류:`, error);
    return [];
  }
}

/**
 * 텍스트 노드 번역
 * @param {Array} textNodes - 텍스트 노드 정보 배열
 * @param {Element[]} elements - 번역 대상 요소 배열
 * @returns {Promise<number>} - 번역된 텍스트 수
 */
async function translateTextNodes(textNodes, elements) {
  try {
    // 입력 검증
    if (!textNodes || !Array.isArray(textNodes) || textNodes.length === 0) {
      console.warn(`[${APP_CONFIG.appName}] 번역할 텍스트 노드가 없습니다.`);
      return 0;
    }
    
    // 모듈 의존성 확인
    if (!checkDependencies()) {
      return 0;
    }
    
    state.isTranslating = true;
    
    // 번역 시작 이벤트 발행
    safeDispatchEvent('dom:translation-start', {
      nodeCount: textNodes.length,
      elementCount: elements ? elements.length : 0
    });
    
    try {
      // UsageManager를 통한 사용량 확인 (가용 여부)
      if (window.UsageManager) {
        const estimatedTokens = window.UsageManager.estimateTokens(textNodes.map(item => item.text || ""));
        const canProceed = await window.UsageManager.canTranslate(estimatedTokens);
        
        if (!canProceed) {
          console.warn(`[${APP_CONFIG.appName}] 번역 한도 초과로 번역 중단`);
          state.isTranslating = false;
          return 0;
        }
      }
      
      // 번역할 텍스트 배열 준비
      const textsToTranslate = textNodes.map(item => item.text || "");
      
      // BatchEngine 설정
      configureBatchEngine();
      
      // 번역 콜백 함수 설정
      setupTranslationCallbacks();
      
      // 배치 처리 시작
      const translatedResults = await BatchEngine.processBatches(textsToTranslate);
      
      // 결과를 텍스트 노드 정보와 결합
      const translationItems = combineResultsWithNodes(textNodes, translatedResults);
      
      // 번역 결과를 DOM에 적용
      const replacedCount = applyTranslations(translationItems, elements);
      
      // 사용량 기록 (UsageManager 사용)
      if (window.UsageManager && replacedCount > 0) {
        const tokensUsed = window.UsageManager.estimateTokens(textsToTranslate);
        await window.UsageManager.recordUsage(tokensUsed);
      }
      
      return replacedCount;
    } catch (error) {
      handleTranslationError(error);
      return 0;
    } finally {
      state.isTranslating = false;
    }
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 번역 프로세스 오류:`, error);
    state.isTranslating = false;
    return 0;
  }
}

/**
 * BatchEngine 설정
 */
function configureBatchEngine() {
  BatchEngine.updateSettings({
    batchSize: settings.batchSize,
    maxConcurrentBatches: settings.maxConcurrentBatches,
    autoDeduplication: true,
    useCache: true
  });
}

/**
 * 번역 콜백 함수 설정
 */
function setupTranslationCallbacks() {
  // 번역 콜백 함수 설정
  BatchEngine.setItemProcessor(async (text) => {
    // TranslatorService 모듈이 있는지 확인
    if (!window.TranslatorService) {
      throw new Error("TranslatorService 모듈이 필요합니다.");
    }
    
    // 번역 서비스 호출
    try {
      const result = await window.TranslatorService.translateText(text);
      return {
        original: text,
        translated: result || text
      };
    } catch (error) {
      console.warn(`[${APP_CONFIG.appName}] 텍스트 번역 오류:`, error);
      return {
        original: text,
        translated: null
      };
    }
  });
  
  // 배치 완료 콜백
  BatchEngine.onBatchComplete(({results, batchIndex}) => {
    safeDispatchEvent('dom:batch-complete', {
      batchIndex,
      count: results.length
    });
  });
  
  // 진행 상태 콜백
  BatchEngine.onProgress((progress) => {
    safeDispatchEvent('dom:translation-progress', { progress });
  });
}

/**
 * 번역 결과와 노드 정보 결합
 * @param {Array} textNodes - 텍스트 노드 정보 배열
 * @param {Array} translatedResults - 번역 결과 배열
 * @returns {Array} - 결합된 번역 항목
 */
function combineResultsWithNodes(textNodes, translatedResults) {
  return textNodes.map((nodeInfo, index) => {
    return {
      ...nodeInfo,
      original: nodeInfo.text,
      translated: translatedResults[index]?.translated || nodeInfo.text
    };
  });
}

/**
 * 번역 결과 DOM에 적용
 * @param {Array} translationItems - 번역 항목
 * @param {Array} elements - 번역할 요소 배열
 * @returns {number} - 적용된 번역 수
 */
function applyTranslations(translationItems, elements) {
  // 번역 결과를 DOM에 적용
  const replacedCount = DOMManipulator.applyTranslations(translationItems);
  
  // 번역 대상 요소들을 번역 완료로 표시
  if (Array.isArray(elements) && elements.length > 0) {
    DOMManipulator.markElementsAsTranslated(elements);
  }
  
  // 번역 완료 이벤트 발행
  safeDispatchEvent('dom:translation-complete', {
    count: replacedCount,
    total: translationItems.length
  });
  
  return replacedCount;
}

/**
 * 번역 오류 처리
 * @param {Error} error - 발생한 오류
 */
function handleTranslationError(error) {
  console.error(`[${APP_CONFIG.appName}] 텍스트 노드 번역 오류:`, error);
  
  // 번역 오류 이벤트 발행
  safeDispatchEvent('dom:translation-error', {
    error: error.message
  });
}

/**
 * 요소 가시성 변경 이벤트 핸들러
 * @param {CustomEvent} event - 요소 가시성 변경 이벤트
 */
function handleElementsVisible(event) {
  try {
    const elements = event.detail?.elements || [];
    
    if (elements.length === 0) {
      return;
    }
    
    console.log(`[${APP_CONFIG.appName}] ${elements.length}개 요소가 화면에 보임`);
    
    // 요소에서 텍스트 노드 추출
    const textNodes = prepareTextNodes(elements);
    
    if (textNodes.length === 0) {
      return;
    }
    
    // 텍스트 노드가 있는 경우 번역 시작
    translateTextNodes(textNodes, elements).catch(error => {
      console.error(`[${APP_CONFIG.appName}] 요소 번역 오류:`, error);
    });
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 요소 가시성 이벤트 처리 오류:`, error);
  }
}

/**
 * 새로운 요소 추가 이벤트 핸들러
 * @param {CustomEvent} event - 요소 추가 이벤트
 */
function handleElementsAdded(event) {
  try {
    const elements = event.detail?.elements || [];
    
    if (elements.length === 0) {
      return;
    }
    
    // DOMSelector, DOMObserver 의존성 확인
    if (!DOMSelector || !DOMObserver) {
      console.error(`[${APP_CONFIG.appName}] DOMSelector, DOMObserver 모듈이 필요합니다.`);
      return;
    }
    
    // 각 요소에서 텍스트 컨테이너 찾기
    const allContainers = [];
    
    elements.forEach(element => {
      try {
        // 텍스트 컨테이너 찾기
        const containers = DOMSelector.findTextContainers(element);
        
        if (containers && containers.length > 0) {
          allContainers.push(...containers);
        }
      } catch (elementError) {
        console.warn(`[${APP_CONFIG.appName}] 요소 텍스트 컨테이너 탐색 오류:`, elementError);
      }
    });
    
    if (allContainers.length === 0) {
      return;
    }
    
    console.log(`[${APP_CONFIG.appName}] ${elements.length}개 요소에서 ${allContainers.length}개 텍스트 컨테이너 발견`);
    
    // 처리 방식 결정 (즉시 번역 또는 관찰)
    processNewContainers(allContainers);
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 요소 추가 이벤트 처리 오류:`, error);
  }
}

/**
 * 새로운 텍스트 컨테이너 처리
 * @param {Element[]} containers - 텍스트 컨테이너 배열
 */
function processNewContainers(containers) {
  switch (true) {
    // 전체 페이지 번역 + 즉시 번역 모드
    case (settings.translateFullPage && settings.immediateTranslation):
      immediatelyTranslateContainers(containers);
      break;
      
    // 기본 모드 (관찰자에 등록)
    default:
      DOMObserver.observeElements(containers);
      break;
  }
}

/**
 * 컨테이너 즉시 번역
 * @param {Element[]} containers - 텍스트 컨테이너 배열
 */
function immediatelyTranslateContainers(containers) {
  // 요소에서 텍스트 노드 추출
  const textNodes = prepareTextNodes(containers);
  
  if (textNodes.length > 0) {
    // 텍스트 노드가 있는 경우 번역 시작
    translateTextNodes(textNodes, containers).catch(error => {
      console.error(`[${APP_CONFIG.appName}] 요소 번역 오류:`, error);
    });
  }
}

/**
 * 이벤트 리스너 설정
 */
function setupEventListeners() {
  try {
    // 요소 가시성 변경 이벤트 리스너
    window.addEventListener('dom:elements-visible', handleElementsVisible);
    
    // 요소 추가 이벤트 리스너
    window.addEventListener('dom:elements-added', handleElementsAdded);
    
    console.log(`[${APP_CONFIG.appName}] 이벤트 리스너 설정 완료`);
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 이벤트 리스너 설정 오류:`, error);
  }
}

/**
 * 전체 페이지 번역
 * @returns {Promise<number>} - 번역된 텍스트 수
 */
async function translateFullPage() {
  try {
    // 이미 번역 중인 경우
    if (state.isTranslating) {
      console.warn(`[${APP_CONFIG.appName}] 이미 번역 중입니다.`);
      return 0;
    }
    
    // 모듈 의존성 확인
    if (!checkDependencies()) {
      return 0;
    }
    
    // 전체 페이지 번역 요청 상태 설정
    state.fullPageRequested = true;
    state.isTranslating = true;
    
    try {
      // 번역 준비 이벤트 발행
      safeDispatchEvent('dom:full-page-translation-start');
      
      // 전체 페이지에서 번역 가능한 모든 텍스트 노드 추출
      const allTextNodes = DOMSelector.extractAllTextNodes();
      
      if (allTextNodes.length === 0) {
        console.warn(`[${APP_CONFIG.appName}] 번역할 텍스트가 없습니다.`);
        state.isTranslating = false;
        state.fullPageRequested = false;
        return 0;
      }
      
      console.log(`[${APP_CONFIG.appName}] 전체 페이지에서 ${allTextNodes.length}개 텍스트 노드 발견`);
      
      // 모든 텍스트 노드 번역
      const translateCount = await translateTextNodes(allTextNodes);
      
      // 전체 페이지 번역 완료 이벤트 발행
      safeDispatchEvent('dom:full-page-translation-complete', {
        count: translateCount,
        total: allTextNodes.length
      });
      
      // UI 이벤트 발행 (UIManager 사용)
      if (window.UIManager) {
        safeDispatchEvent('translation:complete', {
          summary: {
            totalElements: document.querySelectorAll(`[${settings.translatedAttr}]`).length,
            translatedElements: document.querySelectorAll(`[${settings.translatedAttr}]`).length,
            totalTexts: allTextNodes.length,
            translatedTexts: translateCount,
            elapsedTime: Date.now() - state.lastProcessTime
          }
        });
      }
      
      return translateCount;
    } catch (error) {
      console.error(`[${APP_CONFIG.appName}] 전체 페이지 번역 오류:`, error);
      
      // 번역 오류 이벤트 발행
      safeDispatchEvent('dom:full-page-translation-error', {
        error: error.message
      });
      
      return 0;
    } finally {
      // 완료 후 상태 업데이트
      state.isTranslating = false;
      state.fullPageRequested = false;
    }
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 전체 페이지 번역 프로세스 오류:`, error);
    state.isTranslating = false;
    state.fullPageRequested = false;
    return 0;
  }
}

/**
 * 화면에 보이는 요소만 번역
 * @returns {Promise<number>} - 번역된 텍스트 수
 */
async function translateVisibleElements() {
  try {
    // 이미 번역 중인 경우
    if (state.isTranslating) {
      console.warn(`[${APP_CONFIG.appName}] 이미 번역 중입니다.`);
      return 0;
    }
    
    // 모듈 의존성 확인
    if (!checkDependencies()) {
      return 0;
    }
    
    // 화면에 보이는 요소 가져오기
    const visibleElements = DOMObserver.processVisibleElements(DOMSelector.findTextContainers);
    
    if (visibleElements.length === 0) {
      console.warn(`[${APP_CONFIG.appName}] 현재 화면에 번역할 요소가 없습니다.`);
      return 0;
    }
    
    // 요소에서 텍스트 노드 추출
    const textNodes = prepareTextNodes(visibleElements);
    
    if (textNodes.length === 0) {
      console.warn(`[${APP_CONFIG.appName}] 현재 화면에 번역할 텍스트가 없습니다.`);
      return 0;
    }
    
    // 처리 시작 시간 기록
    state.lastProcessTime = Date.now();
    
    // 텍스트 노드 번역
    return await translateTextNodes(textNodes, visibleElements);
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 화면에 보이는 요소 번역 오류:`, error);
    return 0;
  }
}

/**
 * 자동 새로고침 설정
 * @param {boolean} enabled - 활성화 여부
 * @param {number} interval - 새로고침 간격 (ms)
 */
function setupAutoRefresh(enabled = true, interval = 5000) {
  try {
    // 기존 타이머 제거
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    
    // 활성화되지 않은 경우 종료
    if (!enabled) {
      return;
    }
    
    // 새 타이머 설정
    state.autoRefreshInterval = interval;
    
    state.refreshTimer = setInterval(() => {
      processAutoRefreshCycle();
    }, interval);
    
    console.log(`[${APP_CONFIG.appName}] 자동 새로고침 활성화 (${interval}ms 간격)`);
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 자동 새로고침 설정 오류:`, error);
  }
}

/**
 * 자동 새로고침 주기 처리
 */
function processAutoRefreshCycle() {
  try {
    // 번역 중인 경우 건너뜀
    if (state.isTranslating) {
      return;
    }
    
    // 페이지 내 텍스트 컨테이너 검색
    if (DOMSelector) {
      const containers = DOMSelector.findTextContainers(document.body);
      
      // 이전 검색과 동일한 수의 요소인 경우 건너뜀
      if (containers.length === state.lastElementCount) {
        return;
      }
      
      state.lastElementCount = containers.length;
      
      // 미번역 요소 필터링
      const untranslatedElements = containers.filter(element => 
        !element.hasAttribute(settings.translatedAttr) && 
        !element.hasAttribute(settings.pendingAttr)
      );
      
      if (untranslatedElements.length === 0) {
        return;
      }
      
      // 모드에 따른 처리
      processUntranslatedElements(untranslatedElements);
    }
  } catch (refreshError) {
    console.warn(`[${APP_CONFIG.appName}] 자동 새로고침 오류:`, refreshError);
  }
}

/**
 * 미번역 요소 처리
 * @param {Element[]} elements - 미번역 요소 배열
 */
function processUntranslatedElements(elements) {
  switch (true) {
    // 전체 페이지 번역 + 즉시 번역 모드
    case (settings.translateFullPage && settings.immediateTranslation):
      console.log(`[${APP_CONFIG.appName}] 자동 새로고침: ${elements.length}개 미번역 요소 발견`);
      immediatelyTranslateContainers(elements);
      break;
      
    // 나머지 모드 (관찰자 등록)
    default:
      console.log(`[${APP_CONFIG.appName}] 자동 새로고침: ${elements.length}개 미번역 요소 관찰 등록`);
      DOMObserver.observeElements(elements);
      break;
  }
}

/**
 * 번역 시스템 초기화
 * @returns {boolean} - 초기화 성공 여부
 */
function initialize() {
  try {
    // 이미 초기화된 경우
    if (state.isInitialized) {
      return true;
    }
    
    // 모듈 의존성 확인
    if (!checkDependencies()) {
      return false;
    }
    
    // 의존 모듈 설정 업데이트
    updateDependentModuleSettings();
    
    // 이벤트 리스너 설정
    setupEventListeners();
    
    // 관찰자 초기화
    DOMObserver.initialize();
    
    // 자동 새로고침 설정
    if (settings.autoRefresh) {
      setupAutoRefresh(true, state.autoRefreshInterval);
    }
    
    // 초기화 모드에 따른 처리
    handleInitialTranslation();
    
    // 초기화 상태 설정
    state.isInitialized = true;
    
    // 초기화 이벤트 발행
    safeDispatchEvent('dom:initialized', { settings });
    
    console.log(`[${APP_CONFIG.appName}] DOM 핸들러 초기화 완료`);
    return true;
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] DOM 핸들러 초기화 오류:`, error);
    return false;
  }
}

/**
 * 의존 모듈 설정 업데이트
 */
function updateDependentModuleSettings() {
  DOMSelector.updateSettings({
    minTextLength: settings.minTextLength,
    translatedAttr: settings.translatedAttr,
    pendingAttr: settings.pendingAttr
  });
  
  DOMObserver.updateSettings({
    rootMargin: settings.rootMargin,
    preloadThreshold: settings.preloadThreshold,
    translatedAttr: settings.translatedAttr,
    pendingAttr: settings.pendingAttr,
    observeAllOnInit: settings.observeAllOnInit
  });
  
  DOMManipulator.updateSettings({
    translatedAttr: settings.translatedAttr,
    pendingAttr: settings.pendingAttr,
    sourceAttr: settings.sourceAttr
  });
}

/**
 * 초기 번역 처리
 */
function handleInitialTranslation() {
  // 약간의 지연 후 초기 번역 시작 (페이지 로드 완료 보장)
  setTimeout(() => {
    // 초기 모드에 따른 처리
    switch (true) {
      // 전체 페이지 번역 + 즉시 번역 모드
      case (settings.translateFullPage && settings.immediateTranslation):
        translateFullPage().catch(error => {
          console.error(`[${APP_CONFIG.appName}] 초기 페이지 번역 오류:`, error);
        });
        break;
        
      // 기본 모드 (화면에 보이는 요소만 번역)
      default:
        translateVisibleElements().catch(error => {
          console.error(`[${APP_CONFIG.appName}] 초기 화면 번역 오류:`, error);
        });
        break;
    }
  }, 500);
}

/**
 * 번역 상태 설정
 * @param {boolean} isTranslating - 번역 중 상태
 */
function setTranslatingState(isTranslating) {
  try {
    state.isTranslating = !!isTranslating;
    
    // 번역 상태 변경 이벤트 발행
    safeDispatchEvent('dom:translating-state-changed', {
      isTranslating: state.isTranslating
    });
    
    // DOMObserver에도 상태 전달
    if (DOMObserver) {
      DOMObserver.setTranslatingState(state.isTranslating);
    }
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 번역 상태 설정 오류:`, error);
  }
}

/**
 * 번역 상태 가져오기
 * @returns {boolean} - 번역 중 상태
 */
function getTranslatingState() {
  return state.isTranslating;
}

/**
 * 번역 상태 초기화
 */
function resetTranslationState() {
  try {
    // 번역 상태 초기화
    state.isTranslating = false;
    state.fullPageRequested = false;
    
    // 자동 새로고침 타이머 초기화
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    
    // 모듈 의존성 확인
    if (checkDependencies()) {
      resetDependentModules();
    }
    
    // 상태 초기화
    state.isInitialized = false;
    state.lastElementCount = 0;
    
    console.log(`[${APP_CONFIG.appName}] 번역 상태 초기화 완료`);
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 번역 상태 초기화 오류:`, error);
  }
}

/**
 * 의존 모듈 초기화
 */
function resetDependentModules() {
  // 관련 모듈 초기화
  if (DOMObserver) {
    DOMObserver.cleanup();
  }
  
  if (DOMSelector) {
    DOMSelector.resetAllTranslationAttributes();
  }
  
  if (DOMManipulator) {
    DOMManipulator.resetTranslatedElements();
  }
}

/**
 * 모든 리소스 정리 및 관찰자 해제
 */
function cleanup() {
  try {
    // 자동 새로고침 타이머 정리
    if (state.refreshTimer) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
    }
    
    // 모듈 의존성 확인
    if (checkDependencies()) {
      cleanupDependentModules();
    }
    
    // 이벤트 리스너 제거
    removeEventListeners();
    
    // 상태 초기화
    state.isInitialized = false;
    state.isTranslating = false;
    state.fullPageRequested = false;
    state.lastElementCount = 0;
    
    console.log(`[${APP_CONFIG.appName}] 리소스 정리 완료`);
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 리소스 정리 오류:`, error);
  }
}

/**
 * 의존 모듈 정리
 */
function cleanupDependentModules() {
  // 각 모듈 정리
  if (DOMObserver) {
    DOMObserver.cleanup();
  }
  
  if (BatchEngine) {
    // 진행 중인 배치 처리 중단
    BatchEngine.abort();
  }
}

/**
 * 이벤트 리스너 제거
 */
function removeEventListeners() {
  try {
    window.removeEventListener('dom:elements-visible', handleElementsVisible);
    window.removeEventListener('dom:elements-added', handleElementsAdded);
  } catch (listenerError) {
    console.warn(`[${APP_CONFIG.appName}] 이벤트 리스너 제거 오류:`, listenerError);
  }
}

/**
 * 설정 업데이트
 * @param {Object} newSettings - 새 설정 값
 */
function updateSettings(newSettings) {
  try {
    if (!newSettings) return;
    
    const oldSettings = { ...settings };
    settings = { ...settings, ...newSettings };
    
    // 모듈 의존성 확인
    if (state.isInitialized && checkDependencies()) {
      updateDependentModuleSettings();
      
      // 자동 새로고침 설정 업데이트
      if (oldSettings.autoRefresh !== settings.autoRefresh || 
          settings.autoRefresh && state.autoRefreshInterval !== settings.autoRefreshInterval) {
        setupAutoRefresh(settings.autoRefresh, settings.autoRefreshInterval || state.autoRefreshInterval);
      }
    }
    
    console.log(`[${APP_CONFIG.appName}] 설정 업데이트 완료`);
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 설정 업데이트 오류:`, error);
  }
}

/**
 * 현재 설정 가져오기
 * @returns {Object} - 현재 설정
 */
function getSettings() {
  return { ...settings };
}

/**
 * 번역 현황 통계 가져오기
 * @returns {Object} - 번역 통계
 */
function getStatistics() {
  const stats = {
    isTranslating: state.isTranslating,
    isInitialized: state.isInitialized,
    fullPageRequested: state.fullPageRequested,
    autoRefreshActive: !!state.refreshTimer
  };
  
  // 모듈 의존성 확인
  if (checkDependencies()) {
    // 각 모듈에서 통계 수집
    if (DOMManipulator) {
      const manipulatorStats = DOMManipulator.getStatistics();
      Object.assign(stats, manipulatorStats);
    }
    
    if (BatchEngine) {
      const batchStats = BatchEngine.getStatus();
      stats.batchStats = batchStats;
    }
  }
  
  return stats;
}

/**
 * 디버그 모드 설정
 * @param {boolean} enabled - 활성화 여부
 */
function setDebugMode(enabled) {
  try {
    // DOMManipulator 모듈에 디버그 모드 설정 전달
    if (DOMManipulator) {
      DOMManipulator.setDebugMode(!!enabled);
    }
    
    console.log(`[${APP_CONFIG.appName}] 디버그 모드 ${enabled ? '활성화' : '비활성화'}`);
  } catch (error) {
    console.error(`[${APP_CONFIG.appName}] 디버그 모드 설정 오류:`, error);
  }
}

// 모듈 내보내기
export {
  initialize,
  translateFullPage,
  translateVisibleElements,
  setTranslatingState,
  getTranslatingState,
  resetTranslationState,
  updateSettings,
  getSettings,
  cleanup,
  getStatistics,
  setDebugMode,
  translateTextNodes,
  prepareTextNodes
};