// utils/dom-handler.js - IntersectionObserver 중심 개선 버전
const DOMHandler = (function() {
  'use strict';
  
  // 설정
  const DEFAULT_SETTINGS = {
    minTextLength: 2,        // 번역할 최소 텍스트 길이
    rootMargin: '200px',     // IntersectionObserver의 루트 마진
    translatedAttr: 'data-tony-translated', // 번역 완료된 요소 속성
    pendingAttr: 'data-tony-pending',       // 번역 대기 중인 요소 속성
    textContainerSelector: 'p, h1, h2, h3, h4, h5, h6, li, span, a, td, th, caption, label, button, div:not(:empty)',
    ignoreSelector: 'script, style, noscript, code, pre'
  };
  
  // 서비스 설정
  let settings = {...DEFAULT_SETTINGS};
  
  // 상태 관리
  const state = {
    isTranslating: false,          // 번역 중 상태
    intersectionObserver: null,    // IntersectionObserver 인스턴스
    mutationObserver: null,        // MutationObserver 인스턴스
    observedElements: new WeakSet() // 이미 관찰 중인 요소 추적
  };
  
  /**
   * IntersectionObserver 초기화
   * @private
   */
  function initIntersectionObserver() {
    // 이미 초기화되었다면 중복 생성 방지
    if (state.intersectionObserver) return;
    
    state.intersectionObserver = new IntersectionObserver(
      handleIntersection, 
      { 
        rootMargin: settings.rootMargin, 
        threshold: 0.1  // 요소의 10%가 보이면 콜백 실행
      }
    );
    
    console.log("[번역 익스텐션] IntersectionObserver 초기화됨");
  }
  
  /**
   * MutationObserver 초기화
   * @private
   */
  function initMutationObserver() {
    // 이미 초기화되었다면 중복 생성 방지
    if (state.mutationObserver) return;
    
    state.mutationObserver = new MutationObserver(handleMutation);
    
    // document.body 관찰 시작
    if (document.body) {
      state.mutationObserver.observe(document.body, {
        childList: true,  // 자식 노드 추가/제거 감지
        subtree: true     // 모든 하위 트리 변경 감지
      });
      
      console.log("[번역 익스텐션] MutationObserver 초기화됨");
    } else {
      console.warn("[번역 익스텐션] document.body가 준비되지 않았습니다.");
    }
  }
  
  /**
   * IntersectionObserver 콜백 핸들러
   * @private
   * @param {IntersectionObserverEntry[]} entries - 교차 변경된 요소들
   */
  function handleIntersection(entries) {
    // 화면에 보이는 요소만 필터링
    const visibleEntries = entries.filter(entry => entry.isIntersecting);
    
    if (visibleEntries.length === 0 || state.isTranslating) return;
    
    console.log(`[번역 익스텐션] ${visibleEntries.length}개 요소가 화면에 보임`);
    
    // 번역 대상 요소들
    const elementsToProcess = visibleEntries.map(entry => entry.target);
    
    // 화면에 보이는 요소들에서 번역 대상 텍스트 노드 추출
    const visibleNodes = [];
    
    elementsToProcess.forEach(element => {
      // 이미 번역된 요소는 건너뜀
      if (element.hasAttribute(settings.translatedAttr)) return;
      
      // 번역 대기 중으로 표시
      element.setAttribute(settings.pendingAttr, 'true');
      
      // 요소 내의 모든 텍스트 노드 추출
      const textNodes = extractTextNodesFromElement(element);
      
      visibleNodes.push(...textNodes);
    });
    
    // 추출된 텍스트 노드가 있으면 번역 이벤트 발생
    if (visibleNodes.length > 0) {
      console.log(`[번역 익스텐션] ${visibleNodes.length}개 텍스트 노드 번역 준비`);
      
      // 텍스트 번역 이벤트 발생
      window.dispatchEvent(new CustomEvent('dom:textnodes-ready', {
        detail: { nodes: visibleNodes, elements: elementsToProcess }
      }));
    }
  }
  
  /**
   * 요소에서 텍스트 노드 추출
   * @private
   * @param {Element} element - 텍스트 노드를 추출할 요소
   * @returns {Array} - 노드와 위치 정보 배열 [{node, text, xpath}]
   */
  function extractTextNodesFromElement(element) {
    const textNodes = [];
    
    // TreeWalker로 요소 내 모든 텍스트 노드 탐색
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          // 무시할 요소의 자식인 경우 제외
          if (hasParentMatching(node, settings.ignoreSelector)) {
            return NodeFilter.FILTER_REJECT;
          }
          
          // 텍스트 노드의 내용이 있는 경우만 포함
          const text = node.textContent.trim();
          if (text.length >= settings.minTextLength) {
            return NodeFilter.FILTER_ACCEPT;
          }
          
          return NodeFilter.FILTER_SKIP;
        }
      }
    );
    
    // TreeWalker로 노드 탐색
    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (text) {
        textNodes.push({
          node,
          text,
          xpath: getXPathForNode(node),
          type: 'text'
        });
      }
    }
    
    // 속성에 있는 텍스트 (title, alt, placeholder 등) 추가
    ['title', 'alt', 'placeholder', 'aria-label'].forEach(attr => {
      const elements = element.querySelectorAll(`[${attr}]`);
      elements.forEach(el => {
        const text = el.getAttribute(attr).trim();
        if (text && text.length >= settings.minTextLength) {
          textNodes.push({
            node: el,
            text: text,
            xpath: `${getXPathForElement(el)}|attr:${attr}`,
            type: 'attribute',
            attribute: attr
          });
        }
      });
    });
    
    return textNodes;
  }
  
  /**
   * 노드가 특정 선택자에 매칭되는 부모를 가지고 있는지 확인
   * @private
   * @param {Node} node - 확인할 노드
   * @param {string} selector - CSS 선택자
   * @returns {boolean} - 매칭되는 부모 존재 여부
   */
  function hasParentMatching(node, selector) {
    let parent = node.parentNode;
    
    while (parent && parent !== document.body) {
      if (parent.nodeType === Node.ELEMENT_NODE) {
        if (parent.matches(selector)) {
          return true;
        }
      }
      parent = parent.parentNode;
    }
    
    return false;
  }
  
  /**
   * MutationObserver 콜백 핸들러
   * @private
   * @param {MutationRecord[]} mutations - 감지된 DOM 변경 사항
   */
  function handleMutation(mutations) {
    // 번역 중에는 새 요소 처리 건너뜀
    if (state.isTranslating) return;
    
    // 중요한 변경사항이 있는지 먼저 확인
    let hasSignificantChanges = false;
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // 실제 요소 노드가 추가되었는지 확인
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            hasSignificantChanges = true;
            break;
          }
        }
        
        if (hasSignificantChanges) break;
      }
    }
    
    // 중요한 변경사항이 없으면 건너뜀
    if (!hasSignificantChanges) return;
    
    console.log("[번역 익스텐션] DOM 변경 감지됨, 새 텍스트 컨테이너 검색");
    
    // 변경 사항에서 텍스트 컨테이너 요소 찾아서 IntersectionObserver에 등록
    mutations.forEach(mutation => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            findAndObserveTextContainers(node);
          }
        });
      }
    });
  }
  
  /**
   * 요소 내에서 텍스트 컨테이너 요소들을 찾아 관찰 등록
   * @param {Element} root - 검색 시작점 요소
   */
  function findAndObserveTextContainers(root) {
    // 이미 번역된 요소는 건너뜀
    if (root.hasAttribute(settings.translatedAttr) || 
        root.hasAttribute(settings.pendingAttr)) {
      return;
    }
    
    // root 요소 자체가 텍스트 컨테이너인지 확인
    if (isTextContainer(root)) {
      observeElement(root);
    }
    
    // 텍스트 컨테이너 선택자로 하위 요소 검색
    const containers = root.querySelectorAll(settings.textContainerSelector);
    
    containers.forEach(element => {
      // 이미 번역되었거나 번역 대기 중인 요소는 건너뜀
      if (element.hasAttribute(settings.translatedAttr) || 
          element.hasAttribute(settings.pendingAttr)) {
        return;
      }
      
      // 실제 텍스트가 있는 요소만 관찰 대상에 추가
      if (isTextContainer(element)) {
        observeElement(element);
      }
    });
  }
  
  /**
   * 요소가 텍스트 컨테이너인지 확인
   * @private
   * @param {Element} element - 확인할 요소
   * @returns {boolean} - 텍스트 컨테이너 여부
   */
  function isTextContainer(element) {
    // 무시할 선택자에 매칭되는 요소는 제외
    if (element.matches(settings.ignoreSelector)) {
      return false;
    }
    
    // 최소 길이 이상의 텍스트 내용이 있는지 확인
    const text = element.textContent.trim();
    if (text.length < settings.minTextLength) {
      return false;
    }
    
    // 자식 요소 중 텍스트 컨테이너가 있는지 확인
    // 너무 큰 컨테이너(예: div)가 통째로 선택되는 것을 방지
    const hasTextNodeChildren = Array.from(element.childNodes).some(
      node => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length >= settings.minTextLength
    );
    
    // 속성에 텍스트가 있는지 확인
    const hasAttrText = ['title', 'alt', 'placeholder', 'aria-label'].some(
      attr => element.hasAttribute(attr) && element.getAttribute(attr).trim().length >= settings.minTextLength
    );
    
    return hasTextNodeChildren || hasAttrText;
  }
  
  /**
   * 요소를 IntersectionObserver에 등록
   * @private
   * @param {Element} element - 관찰할 요소
   */
  function observeElement(element) {
    // 이미 관찰 중인 요소는 건너뜀
    if (state.observedElements.has(element)) {
      return;
    }
    
    // 번역 대기 중으로 표시
    element.setAttribute(settings.pendingAttr, 'true');
    
    // IntersectionObserver에 등록
    state.intersectionObserver.observe(element);
    
    // 관찰 중인 요소로 추가
    state.observedElements.add(element);
  }
  
  /**
   * 번역된 텍스트를 DOM에 적용
   * @param {Array} translatedItems - [{original, translated, xpath}] 형태의 번역 항목
   * @param {Array} elements - 번역 대상이었던 요소 배열
   * @returns {number} - 교체된 텍스트 수
   */
  function replaceTextsInDOM(translatedItems, elements = []) {
    console.log(`[번역 익스텐션] ${translatedItems.length}개 텍스트 교체 시작`);
    
    let replacedCount = 0;
    
    translatedItems.forEach(item => {
      try {
        const { original, translated, xpath } = item;
        
        // 번역되지 않았거나 원본과 동일한 텍스트는 건너뜀
        if (!translated || original === translated) {
          return;
        }
        
        // 속성인 경우 (xpath|attr:속성명)
        if (xpath.includes('|attr:')) {
          const [elementXpath, attrInfo] = xpath.split('|attr:');
          const attrName = attrInfo;
          const element = getElementByXPath(elementXpath);
          
          if (element && element.hasAttribute(attrName)) {
            element.setAttribute(attrName, translated);
            replacedCount++;
          }
        } 
        // 텍스트 노드인 경우
        else {
          const textNode = getElementByXPath(xpath);
          if (textNode && textNode.nodeType === Node.TEXT_NODE) {
            textNode.textContent = translated;
            replacedCount++;
          }
        }
      } catch (error) {
        console.error("[번역 익스텐션] 텍스트 교체 오류:", error, item);
      }
    });
    
    // 번역 대상 요소들을 번역 완료로 표시
    if (elements && elements.length > 0) {
      elements.forEach(element => {
        if (element.hasAttribute(settings.pendingAttr)) {
          element.removeAttribute(settings.pendingAttr);
          element.setAttribute(settings.translatedAttr, 'true');
        }
      });
    }
    
    console.log(`[번역 익스텐션] ${replacedCount}개 텍스트 교체 완료`);
    
    // 번역 완료 이벤트 발행
    window.dispatchEvent(new CustomEvent('dom:text-replaced', {
      detail: { count: replacedCount }
    }));
    
    return replacedCount;
  }
  
  /**
   * 텍스트 노드의 XPath 생성
   * @private
   * @param {Node} node - XPath를 생성할 노드
   * @returns {string} - 노드의 XPath
   */
  function getXPathForNode(node) {
    // 텍스트 노드인 경우 부모 요소의 XPath + 텍스트 노드 인덱스
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentNode;
      const siblings = Array.from(parent.childNodes);
      const textNodeIndex = siblings.filter(n => n.nodeType === Node.TEXT_NODE).indexOf(node);
      return getXPathForElement(parent) + '/text()[' + (textNodeIndex + 1) + ']';
    }
    
    return getXPathForElement(node);
  }
  
  /**
   * 요소의 XPath 생성
   * @private
   * @param {Element} element - XPath를 생성할 요소
   * @returns {string} - 요소의 XPath
   */
  function getXPathForElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }
    
    // 문서 루트인 경우
    if (element === document.documentElement) {
      return '/html';
    }
    
    // 부모 요소가 없는 경우
    if (!element.parentNode) {
      return '';
    }
    
    // ID가 있는 경우 (고유 식별자)
    if (element.id) {
      return '//*[@id="' + element.id + '"]';
    }
    
    // 부모 요소의 XPath + 현재 요소 태그 및 위치
    const siblings = Array.from(element.parentNode.children).filter(e => e.tagName === element.tagName);
    
    if (siblings.length === 1) {
      return getXPathForElement(element.parentNode) + '/' + element.tagName.toLowerCase();
    }
    
    const index = siblings.indexOf(element) + 1;
    return getXPathForElement(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + index + ']';
  }
  
  /**
   * XPath로 요소 찾기
   * @param {string} xpath - 검색할 XPath
   * @returns {Node} - 찾은 노드 또는 null
   */
  function getElementByXPath(xpath) {
    try {
      return document.evaluate(
        xpath, 
        document, 
        null, 
        XPathResult.FIRST_ORDERED_NODE_TYPE, 
        null
      ).singleNodeValue;
    } catch (e) {
      console.error('[번역 익스텐션] XPath 평가 오류:', e, xpath);
      return null;
    }
  }
  
  /**
   * 번역 시스템 초기화
   * @returns {boolean} - 초기화 성공 여부
   */
  function initialize() {
    try {
      initIntersectionObserver();
      initMutationObserver();
      
      // 초기 페이지 텍스트 컨테이너 찾기 및 관찰 등록
      if (document.body) {
        findAndObserveTextContainers(document.body);
        return true;
      } else {
        // body가 아직 준비되지 않은 경우 이벤트 리스너 추가
        document.addEventListener('DOMContentLoaded', () => {
          findAndObserveTextContainers(document.body);
        });
        return false;
      }
    } catch (error) {
      console.error('[번역 익스텐션] 초기화 오류:', error);
      return false;
    }
  }
  
  /**
   * 번역 상태 설정
   * @param {boolean} isTranslating - 번역 중 상태
   */
  function setTranslatingState(isTranslating) {
    state.isTranslating = isTranslating;
    
    // 상태 변경 이벤트 발행
    window.dispatchEvent(new CustomEvent('dom:translating-state-changed', {
      detail: { isTranslating }
    }));
  }
  
  /**
   * 번역 상태 가져오기
   * @returns {boolean} - 번역 중 상태
   */
  function getTranslatingState() {
    return state.isTranslating;
  }
  
  /**
   * 모든 리소스 정리 및 관찰자 해제
   */
  function cleanup() {
    if (state.intersectionObserver) {
      state.intersectionObserver.disconnect();
      state.intersectionObserver = null;
    }
    
    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
      state.mutationObserver = null;
    }
    
    state.observedElements = new WeakSet();
    console.log('[번역 익스텐션] 리소스 정리 완료');
  }
  
  /**
   * 번역 상태 초기화
   */
  function resetTranslationState() {
    // 번역 상태 및 데이터 속성 초기화
    const translatedElements = document.querySelectorAll(`[${settings.translatedAttr}]`);
    translatedElements.forEach(element => {
      element.removeAttribute(settings.translatedAttr);
    });
    
    const pendingElements = document.querySelectorAll(`[${settings.pendingAttr}]`);
    pendingElements.forEach(element => {
      element.removeAttribute(settings.pendingAttr);
    });
    
    // 상태 초기화
    state.observedElements = new WeakSet();
    
    // 다시 초기화
    initialize();
    
    console.log('[번역 익스텐션] 번역 상태 초기화 완료');
  }
  
  /**
   * 설정 업데이트
   * @param {Object} newSettings - 새 설정 값
   */
  function updateSettings(newSettings) {
    const oldSettings = { ...settings };
    settings = { ...settings, ...newSettings };
    
    // 중요 설정이 변경된 경우 관찰자 재초기화
    if (oldSettings.rootMargin !== settings.rootMargin || 
        oldSettings.textContainerSelector !== settings.textContainerSelector ||
        oldSettings.ignoreSelector !== settings.ignoreSelector) {
      cleanup();
      initialize();
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
   * 특정 선택자의 요소들 찾기
   * @param {string} selector - CSS 선택자
   * @returns {NodeList} - 찾은 요소들
   */
  function findElements(selector) {
    return document.querySelectorAll(selector);
  }
  
  /**
   * 선택자로 단일 요소 찾기
   * @param {string} selector - CSS 선택자
   * @returns {Element|null} - 찾은 요소 또는 null
   */
  function findElement(selector) {
    return document.querySelector(selector);
  }
  
  // 공개 API
  return {
    initialize,
    replaceTextsInDOM,
    getElementByXPath,
    setTranslatingState,
    getTranslatingState,
    resetTranslationState,
    updateSettings,
    getSettings,
    findElements,
    findElement,
    cleanup
  };
})();

// 모듈 내보내기
window.DOMHandler = DOMHandler;