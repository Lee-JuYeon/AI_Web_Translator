// utils/dom-handler.js - 이벤트 발행 부분 중점 개선
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
    observedElements: new WeakSet(), // 이미 관찰 중인 요소 추적
    errorCount: 0,                 // 에러 발생 횟수 (복구 시도용)
    eventsDisabled: false          // 이벤트 발행 비활성화 플래그
  };
  
  /**
   * 안전한 이벤트 발행 함수
   * @param {string} eventName - 이벤트 이름
   * @param {Object} detail - 이벤트 detail 객체
   * @returns {boolean} - 이벤트 발행 성공 여부
   */
  function safeDispatchEvent(eventName, detail) {
    // 이벤트가 비활성화 상태면 발행하지 않음
    if (state.eventsDisabled) {
      console.warn(`[번역 익스텐션] 이벤트 발행 건너뜀 (${eventName}): 이벤트가 비활성화됨`);
      return false;
    }
    
    try {
      // null 방지를 위한 처리
      const safeDetail = detail || {};
      
      // DOM nodes 배열이 있는 경우, 배열 검증
      if (safeDetail.nodes) {
        if (!Array.isArray(safeDetail.nodes)) {
          console.warn(`[번역 익스텐션] 잘못된 nodes 형식`, safeDetail.nodes);
          safeDetail.nodes = []; // 배열이 아니면 빈 배열로 설정
        } else if (safeDetail.nodes.some(node => !node || (typeof node !== 'object'))) {
          // 배열에 잘못된 요소가 있는지 확인
          console.warn(`[번역 익스텐션] nodes 배열에 잘못된 항목이 있음`, safeDetail.nodes);
          // 유효한 항목만 필터링
          safeDetail.nodes = safeDetail.nodes.filter(node => node && (typeof node === 'object'));
        }
      }
      
      // elements 배열이 있는 경우, 배열 검증
      if (safeDetail.elements) {
        if (!Array.isArray(safeDetail.elements)) {
          console.warn(`[번역 익스텐션] 잘못된 elements 형식`, safeDetail.elements);
          safeDetail.elements = []; // 배열이 아니면 빈 배열로 설정
        } else if (safeDetail.elements.some(el => !el || !(el instanceof Element))) {
          // 배열에 잘못된 요소가 있는지 확인
          console.warn(`[번역 익스텐션] elements 배열에 잘못된 항목이 있음`);
          // 유효한 항목만 필터링
          safeDetail.elements = safeDetail.elements.filter(el => el && (el instanceof Element));
        }
      }
      
      // 이벤트 생성 및 발행
      const event = new CustomEvent(eventName, { detail: safeDetail });
      window.dispatchEvent(event);
      return true;
    } catch (error) {
      console.error(`[번역 익스텐션] 이벤트 발행 오류 (${eventName}):`, error);
      
      // 에러 발생 시 이벤트 발행 비활성화 여부 결정
      state.errorCount++;
      if (state.errorCount > 5) {
        console.warn('[번역 익스텐션] 에러가 너무 많이 발생하여 이벤트 발행을 비활성화합니다');
        state.eventsDisabled = true;
      }
      
      return false;
    }
  }
  
  /**
   * IntersectionObserver 초기화
   * @private
   */
  function initIntersectionObserver() {
    // 이미 초기화되었다면 중복 생성 방지
    if (state.intersectionObserver) return;
    
    try {
      state.intersectionObserver = new IntersectionObserver(
        handleIntersection, 
        { 
          rootMargin: settings.rootMargin, 
          threshold: 0.1  // 요소의 10%가 보이면 콜백 실행
        }
      );
      
      console.log("[번역 익스텐션] IntersectionObserver 초기화됨");
    } catch (error) {
      console.error("[번역 익스텐션] IntersectionObserver 초기화 오류:", error);
    }
  }
  
  /**
   * MutationObserver 초기화
   * @private
   */
  function initMutationObserver() {
    // 이미 초기화되었다면 중복 생성 방지
    if (state.mutationObserver) return;
    
    try {
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
    } catch (error) {
      console.error("[번역 익스텐션] MutationObserver 초기화 오류:", error);
    }
  }
  
  /**
   * IntersectionObserver 콜백 핸들러
   * @private
   * @param {IntersectionObserverEntry[]} entries - 교차 변경된 요소들
   */
  function handleIntersection(entries) {
    try {
      // 화면에 보이는 요소만 필터링
      const visibleEntries = entries.filter(entry => entry.isIntersecting);
      
      if (visibleEntries.length === 0 || state.isTranslating) return;
      
      console.log(`[번역 익스텐션] ${visibleEntries.length}개 요소가 화면에 보임`);
      
      // 번역 대상 요소들
      const elementsToProcess = visibleEntries.map(entry => entry.target).filter(Boolean);
      
      // 화면에 보이는 요소들에서 번역 대상 텍스트 노드 추출
      const visibleNodes = [];
      
      elementsToProcess.forEach(element => {
        // 이미 번역된 요소는 건너뜀
        if (element.hasAttribute(settings.translatedAttr)) return;
        
        // 번역 대기 중으로 표시
        element.setAttribute(settings.pendingAttr, 'true');
        
        // 요소 내의 모든 텍스트 노드 추출
        const textNodes = extractTextNodesFromElement(element);
        
        if (textNodes && textNodes.length > 0) {
          visibleNodes.push(...textNodes);
        }
      });
      
      // 추출된 텍스트 노드가 있으면 번역 이벤트 발생
      if (visibleNodes.length > 0) {
        console.log(`[번역 익스텐션] ${visibleNodes.length}개 텍스트 노드 번역 준비`);
        
        // 안전한 이벤트 발행 함수 사용
        safeDispatchEvent('dom:textnodes-ready', { 
          nodes: visibleNodes, 
          elements: elementsToProcess 
        });
      }
    } catch (error) {
      console.error("[번역 익스텐션] Intersection 처리 오류:", error);
    }
  }
  
  /**
   * 요소에서 텍스트 노드 추출
   * @private
   * @param {Element} element - 텍스트 노드를 추출할 요소
   * @returns {Array} - 노드와 위치 정보 배열 [{node, text, xpath}]
   */
  function extractTextNodesFromElement(element) {
    try {
      if (!element || !(element instanceof Element)) {
        return [];
      }
      
      const textNodes = [];
      
      // TreeWalker로 요소 내 모든 텍스트 노드 탐색
      try {
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
          try {
            const text = node.textContent.trim();
            if (text) {
              const xpath = getXPathForNode(node);
              if (xpath) { // XPath가 유효한 경우만 추가
                textNodes.push({
                  node,
                  text,
                  xpath,
                  type: 'text'
                });
              }
            }
          } catch (nodeError) {
            console.warn("[번역 익스텐션] 텍스트 노드 처리 오류:", nodeError);
            // 개별 노드 처리 오류는 무시하고 계속 진행
          }
        }
      } catch (walkerError) {
        console.error("[번역 익스텐션] TreeWalker 오류:", walkerError);
      }
      
      // 속성에 있는 텍스트 (title, alt, placeholder 등) 추가
      try {
        ['title', 'alt', 'placeholder', 'aria-label'].forEach(attr => {
          try {
            // 잘못된 선택자 방지
            let selector = `[${attr}]`;
            try {
              // 선택자 유효성 검사
              document.createDocumentFragment().querySelector(selector);
            } catch (selectorError) {
              console.warn(`[번역 익스텐션] 잘못된 선택자: ${selector}`);
              return; // 이 속성 처리 건너뜀
            }
            
            const elements = element.querySelectorAll(selector);
            elements.forEach(el => {
              try {
                if (el && el.hasAttribute && el.hasAttribute(attr)) {
                  const text = el.getAttribute(attr).trim();
                  if (text && text.length >= settings.minTextLength) {
                    const xpath = getXPathForElement(el);
                    if (xpath) { // XPath가 유효한 경우만 추가
                      textNodes.push({
                        node: el,
                        text: text,
                        xpath: `${xpath}|attr:${attr}`,
                        type: 'attribute',
                        attribute: attr
                      });
                    }
                  }
                }
              } catch (attrNodeError) {
                // 개별 요소 처리 중 오류가 있어도 계속 진행
                console.warn(`[번역 익스텐션] 속성 '${attr}' 노드 처리 오류:`, attrNodeError);
              }
            });
          } catch (attrError) {
            // 특정 속성 처리 중 오류가 있어도 다른 속성 계속 처리
            console.warn(`[번역 익스텐션] 속성 '${attr}' 처리 오류:`, attrError);
          }
        });
      } catch (attrsError) {
        console.error("[번역 익스텐션] 속성 처리 오류:", attrsError);
      }
      
      return textNodes;
    } catch (error) {
      console.error("[번역 익스텐션] 텍스트 노드 추출 오류:", error);
      return [];
    }
  }
  
  /**
   * 노드가 특정 선택자에 매칭되는 부모를 가지고 있는지 확인
   * @private
   * @param {Node} node - 확인할 노드
   * @param {string} selector - CSS 선택자
   * @returns {boolean} - 매칭되는 부모 존재 여부
   */
  function hasParentMatching(node, selector) {
    try {
      if (!node || !selector) return false;
      
      let parent = node.parentNode;
      
      while (parent && parent !== document.body) {
        if (parent.nodeType === Node.ELEMENT_NODE) {
          try {
            if (parent.matches && parent.matches(selector)) {
              return true;
            }
          } catch (matchError) {
            console.warn("[번역 익스텐션] matches 함수 오류:", matchError);
            // 매칭 오류가 발생해도 계속 진행
          }
        }
        parent = parent.parentNode;
      }
      
      return false;
    } catch (error) {
      console.error("[번역 익스텐션] 부모 노드 확인 오류:", error);
      return false;
    }
  }
  
  /**
   * MutationObserver 콜백 핸들러
   * @private
   * @param {MutationRecord[]} mutations - 감지된 DOM 변경 사항
   */
  function handleMutation(mutations) {
    try {
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
    } catch (error) {
      console.error("[번역 익스텐션] Mutation 처리 오류:", error);
    }
  }
  
  /**
   * 요소 내에서 텍스트 컨테이너 요소들을 찾아 관찰 등록
   * @param {Element} root - 검색 시작점 요소
   */
  function findAndObserveTextContainers(root) {
    try {
      if (!root || !(root instanceof Element)) {
        return;
      }
      
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
      try {
        // 선택자 유효성 검사
        try {
          document.createDocumentFragment().querySelector(settings.textContainerSelector);
        } catch (selectorError) {
          console.warn(`[번역 익스텐션] 잘못된 텍스트 컨테이너 선택자: ${settings.textContainerSelector}`);
          return; // 선택자가 잘못되었으면 처리 중단
        }
        
        const containers = root.querySelectorAll(settings.textContainerSelector);
        
        containers.forEach(element => {
          try {
            // 이미 번역되었거나 번역 대기 중인 요소는 건너뜀
            if (element.hasAttribute(settings.translatedAttr) || 
                element.hasAttribute(settings.pendingAttr)) {
              return;
            }
            
            // 실제 텍스트가 있는 요소만 관찰 대상에 추가
            if (isTextContainer(element)) {
              observeElement(element);
            }
          } catch (elementError) {
            console.warn("[번역 익스텐션] 컨테이너 요소 처리 오류:", elementError);
          }
        });
      } catch (querySelectorError) {
        console.error("[번역 익스텐션] querySelector 오류:", querySelectorError);
      }
    } catch (error) {
      console.error("[번역 익스텐션] 텍스트 컨테이너 탐색 오류:", error);
    }
  }
  
  /**
   * 요소가 텍스트 컨테이너인지 확인
   * @private
   * @param {Element} element - 확인할 요소
   * @returns {boolean} - 텍스트 컨테이너 여부
   */
  function isTextContainer(element) {
    try {
      if (!element || !(element instanceof Element)) {
        return false;
      }
      
      // 무시할 선택자에 매칭되는 요소는 제외
      try {
        if (element.matches && element.matches(settings.ignoreSelector)) {
          return false;
        }
      } catch (matchError) {
        console.warn("[번역 익스텐션] matches 함수 오류:", matchError);
      }
      
      // 최소 길이 이상의 텍스트 내용이 있는지 확인
      try {
        const text = element.textContent.trim();
        if (text.length < settings.minTextLength) {
          return false;
        }
      } catch (textContentError) {
        console.warn("[번역 익스텐션] textContent 접근 오류:", textContentError);
        return false;
      }
      
      // 자식 요소 중 텍스트 컨테이너가 있는지 확인
      // 너무 큰 컨테이너(예: div)가 통째로 선택되는 것을 방지
      let hasTextNodeChildren = false;
      try {
        hasTextNodeChildren = Array.from(element.childNodes).some(
          node => node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.trim().length >= settings.minTextLength
        );
      } catch (childrenError) {
        console.warn("[번역 익스텐션] 자식 노드 확인 오류:", childrenError);
      }
      
      // 속성에 텍스트가 있는지 확인
      let hasAttrText = false;
      try {
        hasAttrText = ['title', 'alt', 'placeholder', 'aria-label'].some(
          attr => element.hasAttribute && element.hasAttribute(attr) && element.getAttribute(attr) && element.getAttribute(attr).trim().length >= settings.minTextLength
        );
      } catch (attrError) {
        console.warn("[번역 익스텐션] 속성 확인 오류:", attrError);
      }
      
      return hasTextNodeChildren || hasAttrText;
    } catch (error) {
      console.error("[번역 익스텐션] 텍스트 컨테이너 확인 오류:", error);
      return false;
    }
  }
  
  /**
   * 요소를 IntersectionObserver에 등록
   * @private
   * @param {Element} element - 관찰할 요소
   */
  function observeElement(element) {
    try {
      if (!element || !(element instanceof Element)) {
        return;
      }
      
      // IntersectionObserver가 없으면 초기화
      if (!state.intersectionObserver) {
        initIntersectionObserver();
        if (!state.intersectionObserver) {
          console.error("[번역 익스텐션] IntersectionObserver 초기화 실패");
          return;
        }
      }
      
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
    } catch (error) {
      console.error("[번역 익스텐션] 요소 관찰 등록 오류:", error);
    }
  }
  
  /**
   * 번역된 텍스트를 DOM에 적용
   * @param {Array} translatedItems - [{original, translated, xpath}] 형태의 번역 항목
   * @param {Array} elements - 번역 대상이었던 요소 배열
   * @returns {number} - 교체된 텍스트 수
   */
  function replaceTextsInDOM(translatedItems, elements = []) {
    try {
      // 입력 유효성 검사
      if (!translatedItems || !Array.isArray(translatedItems) || translatedItems.length === 0) {
        console.warn("[번역 익스텐션] 잘못된 번역 항목:", translatedItems);
        return 0;
      }
      
      console.log(`[번역 익스텐션] ${translatedItems.length}개 텍스트 교체 시작`);
      
      let replacedCount = 0;
      
      translatedItems.forEach(item => {
        try {
          if (!item) return;
          
          const { original, translated, xpath } = item;
          
          // 필수 항목 검증
          if (!xpath) {
            console.warn("[번역 익스텐션] xpath가 없는 번역 항목:", item);
            return;
          }
          
          // 번역되지 않았거나 원본과 동일한 텍스트는 건너뜀
          if (!translated || original === translated) {
            return;
          }
          
          // 속성인 경우 (xpath|attr:속성명)
          if (xpath.includes('|attr:')) {
            const [elementXpath, attrInfo] = xpath.split('|attr:');
            const attrName = attrInfo;
            const element = getElementByXPath(elementXpath);
            
            if (element && element instanceof Element && element.hasAttribute && element.hasAttribute(attrName)) {
              try {
                element.setAttribute(attrName, translated);
                replacedCount++;
              } catch (attrError) {
                console.warn("[번역 익스텐션] 속성 설정 오류:", attrError, item);
              }
            }
          } 
          // 텍스트 노드인 경우
          else {
            const textNode = getElementByXPath(xpath);
            if (textNode && textNode.nodeType === Node.TEXT_NODE) {
              try {
                textNode.textContent = translated;
                replacedCount++;
              } catch (textError) {
                console.warn("[번역 익스텐션] 텍스트 설정 오류:", textError, item);
              }
            }
          }
        } catch (itemError) {
          console.error("[번역 익스텐션] 텍스트 교체 오류:", itemError, item);
        }
      });
      
      // 번역 대상 요소들을 번역 완료로 표시
      if (Array.isArray(elements) && elements.length > 0) {
        elements.forEach(element => {
          try {
            if (element && element instanceof Element && element.hasAttribute && element.hasAttribute(settings.pendingAttr)) {
              element.removeAttribute(settings.pendingAttr);
              element.setAttribute(settings.translatedAttr, 'true');
            }
          } catch (elementError) {
            console.warn("[번역 익스텐션] 요소 상태 업데이트 오류:", elementError);
          }
        });
      }
      
      console.log(`[번역 익스텐션] ${replacedCount}개 텍스트 교체 완료`);
      
      // 안전한 이벤트 발행
      safeDispatchEvent('dom:text-replaced', { count: replacedCount });
      
      return replacedCount;
    } catch (error) {
      console.error("[번역 익스텐션] DOM 텍스트 교체 오류:", error);
      return 0;
    }
  }
  
  /**
   * 텍스트 노드의 XPath 생성
   * @private
   * @param {Node} node - XPath를 생성할 노드
   * @returns {string} - 노드의 XPath
   */
  function getXPathForNode(node) {
    try {
      if (!node) return '';
      
      // 텍스트 노드인 경우 부모 요소의 XPath + 텍스트 노드 인덱스
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentNode;
        if (!parent) return '';
        
        const siblings = Array.from(parent.childNodes);
        const textNodes = siblings.filter(n => n.nodeType === Node.TEXT_NODE);
        
        // 부모의 첫 번째 텍스트 노드인 경우 간단한 XPath 사용
        if (textNodes.length === 1) {
          return getXPathForElement(parent) + '/text()';
        }
        
        const textNodeIndex = textNodes.indexOf(node);
        
        if (textNodeIndex >= 0) {
          return getXPathForElement(parent) + '/text()[' + (textNodeIndex + 1) + ']';
        } else {
          return '';
        }
      }
      
      return getXPathForElement(node);
    } catch (error) {
      console.error("[번역 익스텐션] XPath 생성 오류:", error);
      return '';
    }
  }
  
   /**
   * XPath로 요소 찾기
   * @param {string} xpath - 검색할 XPath
   * @returns {Node} - 찾은 노드 또는 null
   */
   function getElementByXPath(xpath) {
    try {
      if (!xpath || typeof xpath !== 'string' || xpath.trim() === '') {
        return null;
      }
      
      // 특수 구문 처리 ("|attr:" 포함하는 경우)
      if (xpath.includes('|attr:')) {
        // 속성 정보는 제외하고 요소 XPath만 사용
        xpath = xpath.split('|')[0];
      }
      
      // document.evaluate가 있는지 확인
      if (!document.evaluate) {
        console.error('[번역 익스텐션] document.evaluate 함수를 사용할 수 없습니다.');
        return null;
      }
      
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
      // 이벤트 시스템 초기화
      state.eventsDisabled = false;
      state.errorCount = 0;
      
      // 관찰자 초기화
      initIntersectionObserver();
      initMutationObserver();
      
      // 초기 페이지 텍스트 컨테이너 찾기 및 관찰 등록
      if (document.body) {
        findAndObserveTextContainers(document.body);
        return true;
      } else {
        // body가 아직 준비되지 않은 경우 이벤트 리스너 추가
        document.addEventListener('DOMContentLoaded', () => {
          try {
            findAndObserveTextContainers(document.body);
          } catch (error) {
            console.error('[번역 익스텐션] DOMContentLoaded 핸들러 오류:', error);
          }
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
    try {
      state.isTranslating = !!isTranslating; // 불리언 타입 강제
      
      // 상태 변경 이벤트 발행 (안전하게)
      safeDispatchEvent('dom:translating-state-changed', { isTranslating: state.isTranslating });
    } catch (error) {
      console.error('[번역 익스텐션] 번역 상태 설정 오류:', error);
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
   * 모든 리소스 정리 및 관찰자 해제
   */
  function cleanup() {
    try {
      if (state.intersectionObserver) {
        try {
          state.intersectionObserver.disconnect();
        } catch (observerError) {
          console.warn('[번역 익스텐션] IntersectionObserver 해제 오류:', observerError);
        }
        state.intersectionObserver = null;
      }
      
      if (state.mutationObserver) {
        try {
          state.mutationObserver.disconnect();
        } catch (observerError) {
          console.warn('[번역 익스텐션] MutationObserver 해제 오류:', observerError);
        }
        state.mutationObserver = null;
      }
      
      state.observedElements = new WeakSet();
      console.log('[번역 익스텐션] 리소스 정리 완료');
    } catch (error) {
      console.error('[번역 익스텐션] 리소스 정리 오류:', error);
    }
  }
  
  /**
   * 번역 상태 초기화
   */
  function resetTranslationState() {
    try {
      // 번역 상태 및 데이터 속성 초기화
      try {
        // 먼저 선택자 유효성 검사
        try {
          document.createDocumentFragment().querySelector(`[data-test]`);
        } catch (selectorError) {
          console.warn('[번역 익스텐션] 선택자 테스트 오류:', selectorError);
          // 선택자 검사 실패 시 안전한 방법으로 대체
          cleanupTranslatedElements();
          return;
        }
        
        // 번역된 요소 데이터 속성 제거
        const translatedElements = document.querySelectorAll(`[${settings.translatedAttr}]`);
        translatedElements.forEach(element => {
          try {
            if (element && element.removeAttribute) {
              element.removeAttribute(settings.translatedAttr);
            }
          } catch (attrError) {
            console.warn('[번역 익스텐션] 속성 제거 오류:', attrError);
          }
        });
        
        // 대기 중인 요소 데이터 속성 제거
        const pendingElements = document.querySelectorAll(`[${settings.pendingAttr}]`);
        pendingElements.forEach(element => {
          try {
            if (element && element.removeAttribute) {
              element.removeAttribute(settings.pendingAttr);
            }
          } catch (attrError) {
            console.warn('[번역 익스텐션] 속성 제거 오류:', attrError);
          }
        });
      } catch (querySelectorError) {
        console.error('[번역 익스텐션] 요소 검색 오류:', querySelectorError);
        // querySelector 오류 시 대체 방법으로 시도
        cleanupTranslatedElements();
      }
      
      // 상태 초기화
      state.observedElements = new WeakSet();
      state.eventsDisabled = false;
      state.errorCount = 0;
      
      // 관찰자 재설정
      cleanup();
      
      // 다시 초기화
      initialize();
      
      console.log('[번역 익스텐션] 번역 상태 초기화 완료');
    } catch (error) {
      console.error('[번역 익스텐션] 번역 상태 초기화 오류:', error);
    }
  }
  
  /**
   * 안전한 방법으로 번역된 요소 정리 (querySelector 오류 시 사용)
   */
  function cleanupTranslatedElements() {
    try {
      // 모든 요소를 순회하며 번역 관련 속성 제거
      function removeTranslationAttributes(element) {
        try {
          if (element && element.hasAttribute) {
            if (element.hasAttribute(settings.translatedAttr)) {
              element.removeAttribute(settings.translatedAttr);
            }
            if (element.hasAttribute(settings.pendingAttr)) {
              element.removeAttribute(settings.pendingAttr);
            }
            
            // 자식 요소들도 처리
            if (element.children && element.children.length > 0) {
              Array.from(element.children).forEach(removeTranslationAttributes);
            }
          }
        } catch (elementError) {
          console.warn('[번역 익스텐션] 요소 속성 정리 오류:', elementError);
        }
      }
      
      // document.body부터 시작
      if (document.body) {
        removeTranslationAttributes(document.body);
      }
    } catch (error) {
      console.error('[번역 익스텐션] 번역 요소 정리 오류:', error);
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
      
      // 중요 설정이 변경된 경우 관찰자 재초기화
      if (oldSettings.rootMargin !== settings.rootMargin || 
          oldSettings.textContainerSelector !== settings.textContainerSelector ||
          oldSettings.ignoreSelector !== settings.ignoreSelector) {
        cleanup();
        initialize();
      }
    } catch (error) {
      console.error('[번역 익스텐션] 설정 업데이트 오류:', error);
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
    try {
      if (!selector || typeof selector !== 'string') return [];
      
      // 선택자 유효성 검사
      try {
        document.createDocumentFragment().querySelector(selector);
      } catch (selectorError) {
        console.warn(`[번역 익스텐션] 잘못된 선택자: ${selector}`, selectorError);
        return [];
      }
      
      return document.querySelectorAll(selector);
    } catch (error) {
      console.error('[번역 익스텐션] 요소 검색 오류:', error);
      return [];
    }
  }
  
  /**
   * 선택자로 단일 요소 찾기
   * @param {string} selector - CSS 선택자
   * @returns {Element|null} - 찾은 요소 또는 null
   */
  function findElement(selector) {
    try {
      if (!selector || typeof selector !== 'string') return null;
      
      // 선택자 유효성 검사
      try {
        document.createDocumentFragment().querySelector(selector);
      } catch (selectorError) {
        console.warn(`[번역 익스텐션] 잘못된 선택자: ${selector}`, selectorError);
        return null;
      }
      
      return document.querySelector(selector);
    } catch (error) {
      console.error('[번역 익스텐션] 요소 검색 오류:', error);
      return null;
    }
  }
  
  /**
   * 이벤트 발행 상태 재설정 (오류 후 복구)
   */
  function resetEventSystem() {
    state.eventsDisabled = false;
    state.errorCount = 0;
    console.log('[번역 익스텐션] 이벤트 시스템 재설정됨');
    return true;
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
    cleanup,
    safeDispatchEvent,
    resetEventSystem
  };
})();

// 모듈 내보내기
window.DOMHandler = DOMHandler;// utils/dom-handler.js - 이벤트 발행 부분 중점 개선