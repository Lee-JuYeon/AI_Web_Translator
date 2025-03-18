// content-script.js - 메시지 통신 방식으로 리팩토링
'use strict';

(function() {
  // ===== 기본 설정 및 상수 =====
  const APP_NAME = 'Tony번역';
  
  // DOM 관련 설정
  const DOM_ATTRIBUTES = {
    translatedAttr: 'data-tony-translated',
    pendingAttr: 'data-tony-pending',
    sourceAttr: 'data-tony-source',
    translationClass: 'tony-translated'
  };
  
  // UI 관련 설정
  const UI_SETTINGS = {
    statusTimeout: 2000,
    limitExceededTimeout: 10000,
    autoHideDelay: 3000,
    progressUpdateInterval: 1000
  };
  
  // 모듈 스코프에서 상태 관리
  let isInitialized = false;
  
  // 애플리케이션 상태
  const AppState = {
    isTranslating: false,
    settings: null,
    pendingTranslation: false,
    
    // 상태 초기화
    reset() {
      this.isTranslating = false;
      this.pendingTranslation = false;
      
      try {
        // DOM 관련 상태 초기화
        document.querySelectorAll(`[${DOM_ATTRIBUTES.pendingAttr}]`).forEach(el => {
          el.removeAttribute(DOM_ATTRIBUTES.pendingAttr);
        });
      } catch (error) {
        console.error(`[${APP_NAME}] 상태 초기화 오류:`, error);
      }
    }
  };
  
  // 오류 처리를 위한 이벤트 리스너
  document.addEventListener('error', function(event) {
    console.error(`[${APP_NAME}] 문서 오류 발생:`, event.error);
  });
  
  // 초기화 즉시 실행
  (function() {
    // 이미 초기화된 경우 중복 실행 방지
    if (isInitialized) {
      console.log(`[${APP_NAME}] 이미 초기화되어 중복 실행 방지`);
      return;
    }
    
    try {
      // 번역기 초기화 실행
      initializeTranslator();
    } catch (error) {
      console.error(`[${APP_NAME}] 초기화 실패:`, error);
    }
  })();
  
  /**
   * 안전한 이벤트 발행 함수
   * @param {string} eventName - 이벤트 이름
   * @param {Object} detail - 이벤트 detail 객체
   * @returns {boolean} - 이벤트 발행 성공 여부
   */
  function safeDispatchEvent(eventName, detail = {}) {
    try {
      const event = new CustomEvent(eventName, { 
        detail: detail || {} // null/undefined 방지
      });
      window.dispatchEvent(event);
      return true;
    } catch (error) {
      console.error(`[${APP_NAME}] 이벤트 발행 오류 (${eventName}):`, error);
      return false;
    }
  }
  
  /**
   * 안전한 이벤트 리스너 생성
   * @param {string} eventName - 이벤트 이름
   * @param {Function} handler - 핸들러 함수
   * @returns {Function} - 안전한 이벤트 핸들러
   */
  function createSafeEventListener(eventName, handler) {
    return function safeHandler(event) {
      try {
        // 이벤트나 detail이 없으면 기본 객체 제공
        const safeEvent = event || { type: eventName };
        const safeDetail = (safeEvent.detail !== null && safeEvent.detail !== undefined) 
          ? safeEvent.detail 
          : {};
          
        // 핸들러 호출 시 안전한 이벤트와 디테일 전달
        handler(safeEvent, safeDetail);
      } catch (error) {
        console.error(`[${APP_NAME}] ${eventName} 이벤트 처리 중 오류:`, error);
      }
    };
  }
  
  /**
   * 확장 프로그램 컨텍스트 유효성 확인
   * @returns {boolean} - 컨텍스트 유효 여부
   */
  function isExtensionContextValid() {
    try {
      // 크롬 API 접근이 가능한지 확인
      chrome.runtime.getManifest();
      return true;
    } catch (e) {
      // "Extension context invalidated" 오류 감지
      if (e.message && e.message.includes('Extension context invalidated')) {
        console.warn(`[${APP_NAME}] 확장 프로그램 컨텍스트가 무효화되었습니다. 페이지 새로고침이 필요합니다.`);
        return false;
      }
      return true; // 다른 오류는 컨텍스트 자체가 무효화된 것은 아님
    }
  }
  
  // ===== 백그라운드 통신 관련 함수 =====
  
  /**
   * 백그라운드로 메시지 전송
   * @param {Object} message - 전송할 메시지
   * @returns {Promise<any>} - 응답 프로미스
   */
  function sendMessageToBackground(message) {
    return new Promise((resolve, reject) => {
      if (!isExtensionContextValid()) {
        reject(new Error('확장 프로그램 컨텍스트가 유효하지 않습니다.'));
        return;
      }
      
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        if (response && response.success) {
          resolve(response);
        } else {
          reject(new Error(response?.error || '알 수 없는 오류'));
        }
      });
    });
  }
  
  /**
   * 설정 로드
   * @returns {Promise<Object>} - 설정 객체
   */
  async function loadSettings() {
    try {
      const response = await sendMessageToBackground({ action: 'getSettings' });
      const settings = response.settings;
      
      // 설정 저장
      AppState.settings = settings;
      
      return settings;
    } catch (error) {
      console.error(`[${APP_NAME}] 설정 로드 오류:`, error);
      // 기본 설정 반환
      return {
        targetLang: 'ko',
        autoTranslate: false,
        batchSize: 40,
        maxConcurrentBatches: 3,
        minTextLength: 2,
        translateFullPage: true,
        immediateTranslation: true
      };
    }
  }
  
  /**
   * 텍스트 번역
   * @param {string} text - 번역할 텍스트
   * @param {Object} options - 번역 옵션
   * @returns {Promise<string>} - 번역된 텍스트
   */
  async function translateText(text, options = {}) {
    try {
      const targetLang = options.targetLang || (AppState.settings && AppState.settings.targetLang) || 'ko';
      
      const response = await sendMessageToBackground({
        action: 'translateText',
        text: text,
        options: {
          targetLang,
          ...options
        }
      });
      
      return response.result;
    } catch (error) {
      console.error(`[${APP_NAME}] 텍스트 번역 오류:`, error);
      return text; // 오류 시 원본 반환
    }
  }
  
  /**
   * 텍스트 배열 번역
   * @param {string[]} texts - 번역할 텍스트 배열
   * @param {Object} options - 번역 옵션
   * @returns {Promise<Array>} - 번역 결과 배열
   */
  async function translateBatch(texts, options = {}) {
    try {
      if (!Array.isArray(texts) || texts.length === 0) {
        return [];
      }
      
      const targetLang = options.targetLang || (AppState.settings && AppState.settings.targetLang) || 'ko';
      const batchSize = options.batchSize || (AppState.settings && AppState.settings.batchSize) || 40;
      const maxConcurrentBatches = options.maxConcurrentBatches || 
        (AppState.settings && AppState.settings.maxConcurrentBatches) || 3;
      
      const response = await sendMessageToBackground({
        action: 'translateBatch',
        texts: texts,
        options: {
          targetLang,
          batchSize,
          maxConcurrentBatches,
          ...options
        }
      });
      
      return response.results;
    } catch (error) {
      console.error(`[${APP_NAME}] 배치 번역 오류:`, error);
      // 오류 시 원본 배열의 각 항목을 원본 텍스트로 매핑
      return texts.map(text => ({
        original: text,
        translated: text
      }));
    }
  }
  
  /**
   * 사용량 기록
   * @param {number} tokens - 사용한 토큰 수
   * @returns {Promise<Object>} - 업데이트된 사용량
   */
  async function recordUsage(tokens) {
    try {
      const response = await sendMessageToBackground({
        action: 'recordUsage',
        tokens: tokens
      });
      
      return response.usage;
    } catch (error) {
      console.error(`[${APP_NAME}] 사용량 기록 오류:`, error);
      return null;
    }
  }
  
  /**
   * 토큰 수 추정
   * @param {string[]} texts - 번역할 텍스트 배열
   * @returns {number} - 추정 토큰 수
   */
  function estimateTokens(texts) {
    try {
      if (!Array.isArray(texts)) return 0;
      
      // 영어 기준 1단어 = 약 1.3 토큰
      const tokenRatio = 1.3;
      
      // 모든 텍스트의 단어 수 계산
      const wordCount = texts.reduce((count, text) => {
        if (typeof text !== 'string') return count;
        return count + text.split(/\s+/).length;
      }, 0);
      
      // 토큰 수 추정 및 10% 버퍼 추가
      return Math.ceil(wordCount * tokenRatio * 1.1);
    } catch (error) {
      console.error(`[${APP_NAME}] 토큰 수 추정 오류:`, error);
      return texts && Array.isArray(texts) ? texts.length * 5 : 10;
    }
  }
  
  // ===== DOM 관련 함수 =====
  
  /**
   * 요소가 텍스트 컨테이너인지 확인
   * @param {Element} element - 확인할 요소
   * @param {number} minTextLength - 최소 텍스트 길이
   * @returns {boolean} - 텍스트 컨테이너 여부
   */
  function isTextContainer(element, minTextLength = 2) {
    try {
      if (!element || !(element instanceof Element)) {
        return false;
      }
      
      // 상태 확인 (번역 완료 또는 대기 중인 요소 제외)
      if (element.hasAttribute(DOM_ATTRIBUTES.translatedAttr) || 
          element.hasAttribute(DOM_ATTRIBUTES.pendingAttr)) {
        return false;
      }
      
      // 무시할 선택자에 매칭되는 요소 제외
      const ignoreSelector = 'script, style, noscript, code, pre';
      if (element.matches && element.matches(ignoreSelector)) {
        return false;
      }
      
      // 요소 내 텍스트 길이 확인
      const text = element.textContent.trim();
      if (text.length < minTextLength) {
        return false;
      }
      
      // 텍스트 노드 확인
      return hasTextNodesOrAttributes(element, minTextLength);
    } catch (error) {
      console.error(`[${APP_NAME}] 텍스트 컨테이너 확인 오류:`, error);
      return false;
    }
  }
  
  /**
   * 텍스트 노드 또는 속성 확인
   * @param {Element} element - 확인할 요소
   * @param {number} minTextLength - 최소 텍스트 길이
   * @returns {boolean} - 텍스트 노드 또는 속성 존재 여부
   */
  function hasTextNodesOrAttributes(element, minTextLength) {
    // 자식 텍스트 노드 확인
    const hasTextNodes = Array.from(element.childNodes).some(
      node => node.nodeType === Node.TEXT_NODE && 
             node.textContent && 
             node.textContent.trim().length >= minTextLength
    );
    
    if (hasTextNodes) return true;
    
    // 속성 텍스트 확인
    return ['title', 'alt', 'placeholder', 'aria-label'].some(
      attr => element.hasAttribute && 
             element.hasAttribute(attr) && 
             element.getAttribute(attr) && 
             element.getAttribute(attr).trim().length >= minTextLength
    );
  }
  
  /**
   * 요소에서 텍스트 노드 추출
   * @param {Element} element - 텍스트 노드를 추출할 요소
   * @param {number} minTextLength - 최소 텍스트 길이
   * @returns {Array} - 노드와 위치 정보 배열 [{node, text, element}]
   */
  function extractTextNodesFromElement(element, minTextLength = 2) {
    try {
      if (!element || !(element instanceof Element)) {
        return [];
      }
      
      const textNodes = [];
      
      // TreeWalker로 요소 내 텍스트 노드 탐색
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: function(node) {
            // 무시할 요소의 자식인 경우 제외
            if (hasParentMatching(node, 'script, style, noscript, code, pre')) {
              return NodeFilter.FILTER_REJECT;
            }
            
            // 텍스트 노드의 내용이 있는 경우만 포함
            const text = node.textContent.trim();
            if (text.length >= minTextLength) {
              return NodeFilter.FILTER_ACCEPT;
            }
            
            return NodeFilter.FILTER_SKIP;
          }
        }
      );
      
      // 텍스트 노드 수집
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent.trim();
        if (text) {
          textNodes.push({
            node,
            text,
            type: 'text',
            element: node.parentElement
          });
        }
      }
      
      // 속성 텍스트 추출 (title, alt 등)
      const textAttributes = ['title', 'alt', 'placeholder', 'aria-label'];
      
      // 요소 자체의 속성 확인
      textAttributes.forEach(attr => {
        if (element.hasAttribute && element.hasAttribute(attr)) {
          const text = element.getAttribute(attr).trim();
          if (text && text.length >= minTextLength) {
            textNodes.push({
              node: element,
              text: text,
              type: 'attribute',
              attribute: attr,
              element: element
            });
          }
        }
      });
      
      return textNodes;
    } catch (error) {
      console.error(`[${APP_NAME}] 텍스트 노드 추출 오류:`, error);
      return [];
    }
  }
  
  /**
   * 노드가 특정 선택자에 매칭되는 부모를 가지고 있는지 확인
   * @param {Node} node - 확인할 노드
   * @param {string} selector - CSS 선택자
   * @returns {boolean} - 매칭되는 부모 존재 여부
   */
  function hasParentMatching(node, selector) {
    if (!node || !selector) {
      return false;
    }
    
    try {
      let parent = node.parentNode;
    
      while (parent && parent !== document.body) {
        if (parent.nodeType === Node.ELEMENT_NODE) {
          if (parent.matches && parent.matches(selector)) {
            return true;
          }
        }
        parent = parent.parentNode;
      }
      
      return false;
    } catch (error) {
      console.error(`[${APP_NAME}] 부모 노드 확인 오류:`, error);
      return false;
    }
  }
  
  /**
   * 번역 결과를 DOM에 적용
   * @param {Array} translationItems - [{original, translated, element, type, attribute}] 형태의 번역 항목
   * @returns {number} - 적용된 번역 수
   */
  function applyTranslations(translationItems) {
    if (!Array.isArray(translationItems) || translationItems.length === 0) {
      return 0;
    }
    
    // 스타일 주입
    injectStyles();
    
    // 결과 카운터
    let successCount = 0;
    
    // 각 번역 항목 처리
    translationItems.forEach(item => {
      try {
        if (!item || !item.translated || item.original === item.translated) {
          return;
        }
        
        // 요소가 없는 경우 무시
        if (!item.element || !(item.element instanceof Element)) {
          return;
        }
        
        let success = false;
        
        // 번역 타입에 따라 다르게 처리
        switch (item.type) {
          case 'attribute':
            if (item.attribute) {
              success = replaceElementAttribute(item.element, item.attribute, item.translated);
            }
            break;
            
          case 'text':
            if (item.node && item.node.nodeType === Node.TEXT_NODE) {
              success = replaceTextNodeContent(item.node, item.translated);
            }
            break;
            
          default:
            // 요소 텍스트 직접 번역
            success = replaceElementText(item.element, item.translated);
            break;
        }
        
        if (success) {
          successCount++;
        }
      } catch (itemError) {
        console.warn(`[${APP_NAME}] 번역 항목 적용 오류:`, itemError);
      }
    });
    
    // 이벤트 발생
    safeDispatchEvent('dom:text-replaced', { 
      count: successCount,
      total: translationItems.length
    });
    
    console.log(`[${APP_NAME}] ${successCount}개 번역 적용 완료 (${translationItems.length - successCount}개 실패)`);
    
    return successCount;
  }
  
  /**
   * 텍스트 노드 내용 교체
   * @param {Node} node - 텍스트 노드
   * @param {string} newText - 새 텍스트
   * @returns {boolean} - 교체 성공 여부
   */
  function replaceTextNodeContent(node, newText) {
    let originalText = '';
    
    try {
      if (!node || node.nodeType !== Node.TEXT_NODE) {
        return false;
      }
      
      originalText = node.textContent;
      
      // 이미 같은 텍스트인 경우 무시
      if (originalText === newText) {
        return false;
      }
      
      // 부모 요소에 원본 텍스트 저장
      if (node.parentElement) {
        node.parentElement.setAttribute(DOM_ATTRIBUTES.sourceAttr, originalText);
      }
      
      // 텍스트 내용 교체
      node.textContent = newText;
      
      // 부모 요소 상태 업데이트
      if (node.parentElement) {
        markElementAsTranslated(node.parentElement);
      }
      
      return true;
    } catch (error) {
      console.error(`[${APP_NAME}] 텍스트 노드 내용 교체 오류:`, error);
      
      // 오류 시 원본 텍스트 복원
      try {
        if (node) node.textContent = originalText;
      } catch (e) {}
      
      return false;
    }
  }
  
  /**
   * 요소 속성 텍스트 교체
   * @param {Element} element - 요소
   * @param {string} attributeName - 속성 이름
   * @param {string} newText - 새 텍스트
   * @returns {boolean} - 교체 성공 여부
   */
  function replaceElementAttribute(element, attributeName, newText) {
    let originalText = '';
    
    try {
      if (!element || !attributeName || !element.hasAttribute(attributeName)) {
        return false;
      }
      
      originalText = element.getAttribute(attributeName);
      
      // 이미 같은 텍스트인 경우 무시
      if (originalText === newText) {
        return false;
      }
      
      // 원본 속성 값 저장
      element.setAttribute(`${DOM_ATTRIBUTES.sourceAttr}-${attributeName}`, originalText);
      
      // 속성 값 교체
      element.setAttribute(attributeName, newText);
      
      // 요소 상태 업데이트
      markElementAsTranslated(element);
      
      return true;
    } catch (error) {
      console.error(`[${APP_NAME}] 요소 속성(${attributeName}) 교체 오류:`, error);
      
      // 오류 시 원본 값 복원
      try {
        if (element) element.setAttribute(attributeName, originalText);
      } catch (e) {}
      
      return false;
    }
  }
  
  /**
   * 요소 텍스트 내용 교체
   * @param {Element} element - 대상 요소
   * @param {string} newText - 새 텍스트
   * @returns {boolean} - 교체 성공 여부
   */
  function replaceElementText(element, newText) {
    let originalText = '';
    
    try {
      if (!element || !(element instanceof Element)) {
        return false;
      }
      
      // 현재 텍스트 내용 가져오기
      originalText = element.textContent;
      
      // 이미 같은 텍스트인 경우 무시
      if (originalText === newText) {
        return false;
      }
      
      // 원본 텍스트 저장
      element.setAttribute(DOM_ATTRIBUTES.sourceAttr, originalText);
      
      // 텍스트 내용 교체
      element.textContent = newText;
      
      // 요소 상태 업데이트
      markElementAsTranslated(element);
      
      return true;
    } catch (error) {
      console.error(`[${APP_NAME}] 요소 텍스트 교체 오류:`, error);
      
      // 오류 시 원본 텍스트 복원
      try {
        if (element) element.textContent = originalText;
      } catch (e) {}
      
      return false;
    }
  }
  
  /**
   * 요소를 번역 완료로 표시
   * @param {Element} element - 대상 요소
   */
  function markElementAsTranslated(element) {
    try {
      if (!element || !(element instanceof Element)) {
        return;
      }
      
      // 번역 완료 표시
      element.setAttribute(DOM_ATTRIBUTES.translatedAttr, 'true');
      
      // 대기 상태 제거
      if (element.hasAttribute(DOM_ATTRIBUTES.pendingAttr)) {
        element.removeAttribute(DOM_ATTRIBUTES.pendingAttr);
      }
      
      // 번역된 클래스 추가
      element.classList.add(DOM_ATTRIBUTES.translationClass);
      
      // 애니메이션 효과 적용
      element.classList.add('tony-translating');
      setTimeout(() => {
        element.classList.remove('tony-translating');
      }, 500);
    } catch (error) {
      console.error(`[${APP_NAME}] 요소 상태 업데이트 오류:`, error);
    }
  }
  
  /**
   * 요소를 번역 대기 중으로 표시
   * @param {Element} element - 대상 요소
   */
  function markElementAsPending(element) {
    try {
      if (!element || !(element instanceof Element)) {
        return;
      }
      
      // 이미 번역된 요소는 무시
      if (element.hasAttribute(DOM_ATTRIBUTES.translatedAttr)) {
        return;
      }
      
      // 번역 대기 중 표시
      element.setAttribute(DOM_ATTRIBUTES.pendingAttr, 'true');
    } catch (error) {
      console.error(`[${APP_NAME}] 요소 대기 상태 설정 오류:`, error);
    }
  }
  
  /**
   * DOM에 번역 관련 스타일 주입
   */
  function injectStyles() {
    // 이미 주입된 경우 중복 방지
    if (document.getElementById('tony-translator-styles')) {
      return;
    }
    
    try {
      const styleElement = document.createElement('style');
      styleElement.id = 'tony-translator-styles';
      styleElement.textContent = `
        .${DOM_ATTRIBUTES.translationClass} {
          transition: background-color 0.3s ease;
        }
        
        .tony-translating {
          animation: tony-fade-in 0.5s ease;
        }
        
        @keyframes tony-fade-in {
          from { opacity: 0.7; }
          to { opacity: 1; }
        }
        
        [${DOM_ATTRIBUTES.translatedAttr}][${DOM_ATTRIBUTES.sourceAttr}]:hover::after {
          content: attr(${DOM_ATTRIBUTES.sourceAttr});
          position: absolute;
          top: 100%;
          left: 0;
          background: white;
          color: #333;
          border: 1px solid #ccc;
          padding: 4px 8px;
          font-size: 12px;
          z-index: 9999;
          max-width: 300px;
          box-shadow: 0 2px 5px rgba(0,0,0,0.2);
          border-radius: 4px;
          opacity: 0.9;
          pointer-events: none;
        }
        
        [${DOM_ATTRIBUTES.translatedAttr}][${DOM_ATTRIBUTES.sourceAttr}] {
          position: relative;
        }
      `;
      
      document.head.appendChild(styleElement);
      console.log(`[${APP_NAME}] 번역 스타일 주입 완료`);
    } catch (error) {
      console.error(`[${APP_NAME}] 스타일 주입 오류:`, error);
    }
  }
  
  /**
   * 요소 내에서 텍스트 컨테이너 요소들을 찾기
   * @param {Element} root - 검색 시작점 요소
   * @param {number} minTextLength - 최소 텍스트 길이
   * @returns {Array<Element>} - 찾은 텍스트 컨테이너 요소 배열
   */
  function findTextContainers(root, minTextLength = 2) {
    try {
      if (!root || !(root instanceof Element)) {
        return [];
      }
      
      const containers = [];
      const textContainerSelector = 'p, h1, h2, h3, h4, h5, li, span, a, td, div, article';
      const additionalSelector = '.text, .title, .headline, .desc, .content, .caption, .summary, .article-txt, .article-tit';
      
      // 이미 번역된 요소는 건너뜀
      if (root.hasAttribute(DOM_ATTRIBUTES.translatedAttr)) {
        return containers;
      }
      
      // root 요소 자체가 텍스트 컨테이너인지 확인
      if (isTextContainer(root, minTextLength)) {
        containers.push(root);
      }
      
      // 선택자로 하위 요소 검색
      try {
        const fullSelector = `${textContainerSelector}, ${additionalSelector}`;
        const elements = root.querySelectorAll(fullSelector);
        
        elements.forEach(element => {
          try {
            // 번역 관련 속성이 있는 요소는 제외
            if (element.hasAttribute(DOM_ATTRIBUTES.translatedAttr) ||
                element.hasAttribute(DOM_ATTRIBUTES.pendingAttr)) {
              return;
            }
            
            // 무시할 선택자에 매칭되는 요소는 제외
            const ignoreSelector = 'script, style, noscript, code, pre';
            if (element.matches && element.matches(ignoreSelector)) {
              return;
            }
            
            // 텍스트 내용이 있는 요소만 추가
            if (element.textContent.trim().length >= minTextLength) {
              containers.push(element);
            }
          } catch (elementError) {
            console.warn(`[${APP_NAME}] 컨테이너 요소 처리 오류:`, elementError);
          }
        });
      } catch (selectorError) {
        console.error(`[${APP_NAME}] 선택자 검색 오류:`, selectorError);
      }
      
      return containers;
    } catch (error) {
      console.error(`[${APP_NAME}] 텍스트 컨테이너 탐색 오류:`, error);
      return [];
    }
  }
  
  /**
   * 텍스트 노드 처리
   * @param {Array} nodeInfoList - 텍스트 노드 정보 배열
   * @param {Array} elements - 번역 대상 요소 배열
   * @returns {Promise<number>} - 번역된 텍스트 수
   */
  async function processTextNodes(nodeInfoList, elements) {
    // 입력 검증
    if (!nodeInfoList || !Array.isArray(nodeInfoList) || nodeInfoList.length === 0) {
      console.warn(`[${APP_NAME}] 유효하지 않은 노드 정보 목록:`, nodeInfoList);
      return 0;
    }
    
    // 이미 번역 중이면 대기
    if (AppState.pendingTranslation) {
      console.log(`[${APP_NAME}] 이미 번역 작업이 대기 중입니다.`);
      return 0;
    }
    
    AppState.pendingTranslation = true;
    
    try {
      // 텍스트 배열 추출
      const textsToTranslate = nodeInfoList.map(item => item.text || "");
      
      // 번역 이벤트 리스너 등록
      const batchCompleteListener = createSafeEventListener('translation:batch-complete', 
        (event, detail) => {
          if (detail) {
            const total = detail.total || 0;
            const completed = detail.completed || 0;
            const cachedCount = detail.cachedCount || 0;
            const newCount = detail.newCount || 0;
            
            showTranslationStatus(
              `${total}개 항목 번역 중... (${completed}/${total} 배치, 캐시: ${cachedCount}, 신규: ${newCount})`
            );
          }
        }
      );
      
      // 이벤트 리스너 등록
      document.addEventListener('translation:batch-complete', batchCompleteListener);
      
      // 사용량 한도 확인
      const estimatedTokenCount = estimateTokens(textsToTranslate);
      
      // 메시지를 통해 백그라운드 스크립트에서 배치 처리 수행
      const translatedItems = await translateBatch(
        textsToTranslate, 
        {
          batchSize: (AppState.settings && AppState.settings.batchSize) || 40,
          maxConcurrentBatches: (AppState.settings && AppState.settings.maxConcurrentBatches) || 3
        }
      );
      
      // 이벤트 리스너 제거
      document.removeEventListener('translation:batch-complete', batchCompleteListener);
      
      // 번역 결과가 없으면 종료
      if (!translatedItems || !Array.isArray(translatedItems)) {
        console.warn(`[${APP_NAME}] 번역 결과가 없습니다.`);
        AppState.pendingTranslation = false;
        return 0;
      }
      
      // 번역 결과를 DOM에 적용하기 위한 형식으로 변환
      const translationDataForDOM = translatedItems.map((item, index) => {
        // 인덱스가 범위를 벗어나면 빈 객체 반환
        if (!nodeInfoList[index]) return { original: "", translated: "", element: null };
        
        return {
          original: item.original || "",
          translated: item.translated || "",
          element: nodeInfoList[index].element,
          node: nodeInfoList[index].node,
          type: nodeInfoList[index].type,
          attribute: nodeInfoList[index].attribute
        };
      }).filter(item => item.element); // 요소가 없는 항목 제거
      
      // 번역된 텍스트 DOM에 적용
      const replacedCount = applyTranslations(translationDataForDOM);
      
      // 요소들을 번역 완료로 표시
      if (Array.isArray(elements) && elements.length > 0) {
        elements.forEach(element => markElementAsTranslated(element));
      }
      
      // 사용량 기록
      await recordUsage(estimatedTokenCount);
      
      AppState.pendingTranslation = false;
      
      return replacedCount;
    } catch (error) {
      console.error(`[${APP_NAME}] 텍스트 노드 처리 오류:`, error);
      AppState.pendingTranslation = false;
      return 0;
    }
  }
  
  // ===== UI 관련 함수 =====
  
  /**
   * 번역 진행 상태 표시 UI 생성 및 표시
   * @param {string} message - 표시할 메시지
   * @param {boolean} isComplete - 완료 상태 여부
   * @param {boolean} autoHide - 자동 숨김 여부
   * @returns {HTMLElement} - 생성된 상태 요소
   */
  function showTranslationStatus(message, isComplete = false, autoHide = false) {
    // 기존 타이머 취소
    clearTranslationStatusTimeout();
    
    // 상태 요소 ID
    const statusElementId = 'translation-status-bar';
    let statusElement = document.getElementById(statusElementId);
    
    // 상태 요소 생성 또는 업데이트
    if (!statusElement) {
      statusElement = document.createElement('div');
      statusElement.id = statusElementId;
      statusElement.textContent = message;
      
      // 스타일 적용
      Object.assign(statusElement.style, {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        padding: '10px 15px',
        background: isComplete ? '#4CAF50' : '#2196F3',
        color: 'white',
        borderRadius: '5px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        zIndex: '9999',
        fontSize: '14px',
        fontFamily: 'Arial, sans-serif',
        transition: 'all 0.3s ease',
        maxWidth: '300px'
      });
      
      document.body.appendChild(statusElement);
    } else {
      // 기존 요소 업데이트
      statusElement.textContent = message;
      statusElement.style.background = isComplete ? '#4CAF50' : '#2196F3';
    }
    
    // 자동 숨김 설정
    if (autoHide) {
      window.translationStatusTimer = setTimeout(() => {
        hideTranslationStatus();
      }, UI_SETTINGS.autoHideDelay);
    }
    
    return statusElement;
  }
  
  /**
   * 상태 표시 타이머 제거
   */
  function clearTranslationStatusTimeout() {
    if (window.translationStatusTimer) {
      clearTimeout(window.translationStatusTimer);
      window.translationStatusTimer = null;
    }
  }
  
  /**
   * 번역 상태 UI 숨기기
   */
  function hideTranslationStatus() {
    const statusElement = document.getElementById('translation-status-bar');
    if (statusElement) {
      // 애니메이션 후 제거
      statusElement.style.opacity = '0';
      setTimeout(() => {
        if (statusElement.parentNode) {
          statusElement.parentNode.removeChild(statusElement);
        }
      }, 300);
    }
    
    clearTranslationStatusTimeout();
  }
  
  /**
   * 번역 한도 초과 알림 표시
   * @param {Function} onUpgradeClick - 업그레이드 버튼 클릭 시 콜백
   */
  function showTranslationLimitExceeded(onUpgradeClick) {
    const limitElementId = 'translation-limit-exceeded';
    let limitElement = document.getElementById(limitElementId);
    
    if (!limitElement) {
      // 알림 컨테이너 생성
      limitElement = document.createElement('div');
      limitElement.id = limitElementId;
      limitElement.innerHTML = `
        <p><strong>번역 한도 초과!</strong></p>
        <p>이번 달 번역 한도를 모두 사용했습니다.</p>
        <p>더 많은 번역을 위해 구독 등급을 업그레이드하세요.</p>
        <button id="upgrade-subscription">업그레이드</button>
      `;
      
      // 스타일 적용
      Object.assign(limitElement.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '15px 20px',
        background: '#f44336',
        color: 'white',
        borderRadius: '5px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        zIndex: '9999',
        fontSize: '14px',
        fontFamily: 'Arial, sans-serif',
        textAlign: 'center',
        maxWidth: '300px'
      });
      
      document.body.appendChild(limitElement);
      
      // 업그레이드 버튼 설정
      const upgradeButton = limitElement.querySelector('#upgrade-subscription');
      if (upgradeButton) {
        // 버튼 스타일 설정
        Object.assign(upgradeButton.style, {
          background: 'white',
          color: '#f44336',
          border: 'none',
          padding: '8px 15px',
          marginTop: '10px',
          borderRadius: '3px',
          cursor: 'pointer',
          fontWeight: 'bold'
        });
        
        // 버튼 클릭 이벤트
        upgradeButton.addEventListener('click', () => {
          // 콜백 실행
          if (typeof onUpgradeClick === 'function') {
            onUpgradeClick();
          }
          
          // 알림 숨기기
          limitElement.style.display = 'none';
        });
      }
      
      // 자동 숨김
      setTimeout(() => {
        if (limitElement.parentNode) {
          limitElement.style.opacity = '0';
          limitElement.style.transition = 'opacity 0.5s';
          setTimeout(() => {
            if (limitElement.parentNode) {
              limitElement.parentNode.removeChild(limitElement);
            }
          }, 500);
        }
      }, UI_SETTINGS.limitExceededTimeout);
    }
    
    return limitElement;
  }
  
  // ===== 이벤트 및 초기화 함수 =====
  
  /**
   * 이벤트 리스너 설정
   */
  function setupEventListeners() {
    // DOM 관련 이벤트 리스너
    document.addEventListener('dom:translating-state-changed', createSafeEventListener(
      'dom:translating-state-changed',
      (event, detail) => {
        AppState.isTranslating = detail.isTranslating === true;
      }
    ));
    
    // 번역 완료 이벤트 리스너
    document.addEventListener('dom:text-replaced', createSafeEventListener(
      'dom:text-replaced',
      (event, detail) => {
        const count = detail.count || 0;
        console.log(`[${APP_NAME}] ${count}개 텍스트 교체됨`);
      }
    ));
  }
  
  /**
   * 크롬 메시지 리스너 설정
   */
  function setupMessageListeners() {
    // 컨텍스트가 유효하지 않으면 실행하지 않음
    if (!isExtensionContextValid()) return;
    
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      try {
        switch (request.action) {
          case "ping":
            // 페이지에 로드되었는지 확인용
            sendResponse({ status: "ready" });
            return true;
            
          case "translatePage":
            // 페이지 번역 요청
            translatePage().then(result => {
              if (isExtensionContextValid()) {
                sendResponse({ success: true, result });
              }
            }).catch(error => {
              console.error(`[${APP_NAME}] 오류:`, error);
              if (isExtensionContextValid()) {
                sendResponse({ success: false, error: error.message || '알 수 없는 오류' });
              }
            });
            return true; // 비동기 응답을 위해 true 반환
            
          case "updateSettings":
            // 설정 업데이트
            if (request.settings) {
              AppState.settings = request.settings;
            }
            
            sendResponse({ success: true });
            return true;
            
          default:
            // 알 수 없는 메시지는 무시
            return false;
        }
      } catch (error) {
        console.error(`[${APP_NAME}] 메시지 처리 오류:`, error);
        // 컨텍스트가 여전히 유효하면 응답 시도
        if (isExtensionContextValid()) {
          sendResponse({ success: false, error: error.message || '알 수 없는 오류' });
        }
        return true;
      }
    });
  }
  
  /**
   * 요소가 화면에 보이는지 확인
   * @param {Element} element - 확인할 요소
   * @returns {boolean} - 화면에 보이는지 여부
   */
  function isElementVisible(element) {
    try {
      if (!element || !(element instanceof Element)) {
        return false;
      }
      
      // 요소의 위치 및 크기 정보
      const rect = element.getBoundingClientRect();
      
      // 화면 크기
      const viewHeight = Math.max(document.documentElement.clientHeight, window.innerHeight);
      const viewWidth = Math.max(document.documentElement.clientWidth, window.innerWidth);
      
      // 화면 밖에 있는지 확인
      if (rect.bottom < 0 || rect.top > viewHeight || 
          rect.right < 0 || rect.left > viewWidth) {
        return false;
      }
      
      // 요소의 스타일 확인
      const style = window.getComputedStyle(element);
      
      // 화면에 표시되지 않는 경우
      return !(style.display === 'none' || 
               style.visibility === 'hidden' || 
               style.opacity === '0' || 
               element.offsetParent === null);
    } catch (error) {
      console.error(`[${APP_NAME}] 요소 가시성 확인 오류:`, error);
      return false;
    }
  }
  
  /**
   * 화면에 보이는 요소 찾기 및 처리
   * @returns {Element[]} - 화면에 보이는 요소 배열
   */
  function findVisibleElements() {
    try {
      // 페이지 내 텍스트 컨테이너 검색
      const minTextLength = AppState.settings?.minTextLength || 2;
      
      const containers = findTextContainers(document.body, minTextLength);
      const visibleElements = [];
      
      // 화면에 보이는 요소 필터링
      containers.forEach(element => {
        if (isElementVisible(element)) {
          visibleElements.push(element);
          markElementAsPending(element);
        }
      });
      
      return visibleElements;
    } catch (error) {
      console.error(`[${APP_NAME}] 화면에 보이는 요소 검색 오류:`, error);
      return [];
    }
  }
  
  /**
   * 웹페이지 번역 프로세스
   * @returns {Promise<string>} - 번역 결과 메시지
   */
  async function translatePage() {
    console.log(`[${APP_NAME}] 페이지 번역 시작`);
    
    // 이미 번역 중이면 중복 실행 방지
    if (AppState.isTranslating) {
      return "이미 번역 중입니다.";
    }
    
    // 컨텍스트 확인
    if (!isExtensionContextValid()) {
      console.warn(`[${APP_NAME}] 확장 프로그램 컨텍스트가 무효화됨`);
      return "확장 프로그램 컨텍스트 오류. 페이지를 새로고침 해주세요.";
    }
    
    // 번역 상태 설정
    AppState.isTranslating = true;
    safeDispatchEvent('dom:translating-state-changed', { isTranslating: true });
    
    // 번역 진행 상태 표시
    showTranslationStatus("번역 준비 중...");
    
    try {
      // 설정 로드 (필요시)
      if (!AppState.settings) {
        await loadSettings();
      }
      
      // 기존 번역 상태 초기화
      AppState.reset();
      
      // 화면에 보이는 요소들 가져오기
      const visibleElements = findVisibleElements();
      
      // 화면에 보이는 요소들에서 텍스트 노드 추출
      const textNodes = [];
      visibleElements.forEach(element => {
        const nodes = extractTextNodesFromElement(element, AppState.settings?.minTextLength || 2);
        if (nodes && nodes.length > 0) {
          textNodes.push(...nodes);
        }
      });
      
      if (textNodes.length === 0) {
        AppState.isTranslating = false;
        safeDispatchEvent('dom:translating-state-changed', { isTranslating: false });
        hideTranslationStatus();
        return "번역할 텍스트가 없습니다.";
      }
      
      showTranslationStatus("번역 진행 중...");
      
      // 텍스트 노드 처리
      await processTextNodes(textNodes, visibleElements);
      
      // 완료 메시지 표시
      showTranslationStatus("번역 완료! 페이지 스크롤 시 추가 콘텐츠가 자동으로 번역됩니다.", true, true);
      
      // 스크롤 이벤트 리스너 설정 (화면에 새로운 요소가 나타나면 자동 번역)
      setupScrollHandler();
      
      // 번역 상태 업데이트
      setTimeout(() => {
        AppState.isTranslating = false;
        safeDispatchEvent('dom:translating-state-changed', { isTranslating: false });
      }, UI_SETTINGS.autoHideDelay);
      
      return "번역이 시작되었습니다. 페이지 스크롤 시 추가 콘텐츠가 자동으로 번역됩니다.";
    } catch (error) {
      console.error(`[${APP_NAME}] 번역 오류:`, error);
      hideTranslationStatus();
      
      AppState.isTranslating = false;
      safeDispatchEvent('dom:translating-state-changed', { isTranslating: false });
      
      return `번역 오류: ${error.message || '알 수 없는 오류'}`;
    }
  }
  
  /**
   * 스크롤 핸들러 설정 (화면에 새로운 요소가 나타나면 자동 번역)
   */
  function setupScrollHandler() {
    // 기존 핸들러 제거
    window.removeEventListener('scroll', handleScroll);
    
    // 새 핸들러 추가
    window.addEventListener('scroll', handleScroll);
    
    // 스크롤 이벤트 제한 (디바운스)
    let scrollTimeout;
    
    function handleScroll() {
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      
      scrollTimeout = setTimeout(() => {
        // 번역 중인지 확인
        if (AppState.isTranslating || AppState.pendingTranslation) {
          return;
        }
        
        // 화면에 보이는 요소 찾기
        const visibleElements = findVisibleElements();
        
        // 번역 대기 중이 아닌 요소 필터링
        const elementsToTranslate = visibleElements.filter(element => 
          !element.hasAttribute(DOM_ATTRIBUTES.translatedAttr) && 
          !element.hasAttribute(DOM_ATTRIBUTES.pendingAttr)
        );
        
        if (elementsToTranslate.length > 0) {
          console.log(`[${APP_NAME}] 스크롤 이벤트: ${elementsToTranslate.length}개 새 요소 감지`);
          
          // 요소들에서 텍스트 노드 추출
          const textNodes = [];
          elementsToTranslate.forEach(element => {
            const nodes = extractTextNodesFromElement(element, AppState.settings?.minTextLength || 2);
            if (nodes && nodes.length > 0) {
              textNodes.push(...nodes);
            }
          });
          
          if (textNodes.length > 0) {
            processTextNodes(textNodes, elementsToTranslate).catch(error => {
              console.error(`[${APP_NAME}] 스크롤 시 노드 처리 오류:`, error);
            });
          }
        }
      }, 200); // 200ms 디바운스
    }
  }
  
  /**
   * 페이지 로드 완료 시 자동 번역 설정
   */
  function setupAutoTranslate() {
    try {
      const autoTranslateHandler = () => {
        // 설정 로드
        loadSettings().then(settings => {
          if (settings && settings.autoTranslate) {
            translatePage().catch(error => {
              console.error(`[${APP_NAME}] 자동 번역 오류:`, error);
            });
          }
        }).catch(error => {
          console.error(`[${APP_NAME}] 설정 로드 오류:`, error);
        });
      };
      
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoTranslateHandler);
      } else {
        // 이미 DOM이 로드된 경우
        autoTranslateHandler();
      }
    } catch (error) {
      console.error(`[${APP_NAME}] 자동 번역 설정 오류:`, error);
    }
  }
  
  /**
   * 번역 확장 초기화 메인 함수
   */
  async function initializeTranslator() {
    try {
      console.log(`[${APP_NAME}] 초기화 시작`);
      
      // 초기화 표시 - 플래그 설정
      isInitialized = true;
      
      // 이벤트 리스너 설정
      setupEventListeners();
      
      // 크롬 메시지 리스너 설정 (확장 프로그램 컨텍스트가 유효한 경우에만)
      if (isExtensionContextValid()) {
        setupMessageListeners();
      }
      
      // 설정 로드
      await loadSettings();
      
      // 자동 번역 설정
      setupAutoTranslate();
      
      // 페이지 언로드 시 리소스 정리
      window.addEventListener('beforeunload', () => {
        try {
          // 스크롤 핸들러 제거
          window.removeEventListener('scroll', handleScroll);
        } catch (error) {
          console.error(`[${APP_NAME}] 리소스 정리 오류:`, error);
        }
      });
      
      console.log(`[${APP_NAME}] 초기화 완료`);
    } catch (error) {
      console.error(`[${APP_NAME}] 초기화 실패:`, error);
      throw error;
    }
  }
  
  // 글로벌 스코프에 API 노출 (다른 스크립트에서 접근 가능)
  window.TonyTranslator = {
    translatePage,
    getState: () => ({ 
      isTranslating: AppState.isTranslating,
      settings: AppState.settings,
      initialized: isInitialized
    })
  };
})();