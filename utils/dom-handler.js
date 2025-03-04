// utils/dom-handler.js
const DOMHandler = (function() {
    'use strict';
    
    // 설정
    const DEFAULT_SETTINGS = {
      minTextLength: 2,  // 번역할 최소 텍스트 길이
      scrollThreshold: 200 // 스크롤 감지 임계값 (픽셀)
    };
    
    // 서비스 설정
    let settings = {...DEFAULT_SETTINGS};
    
    // 상태 관리
    const state = {
      processedNodes: new WeakSet(), // 이미 처리된 노드 추적
      lastScrollPosition: 0,         // 마지막 스크롤 위치
      scrollTimer: null,             // 스크롤 타이머
      isTranslating: false           // 번역 중 상태
    };
    
    /**
     * 현재 화면에 보이는 텍스트 노드 추출
     * @param {Element} element - 시작 요소 (보통 document.body)
     * @returns {Array} - 노드와 위치 정보 배열 [{node, text, xpath}]
     */
    function extractVisibleTextNodes(element) {
      const visibleNodes = [];
      
      // TreeWalker로 모든 노드 탐색
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: function(node) {
            // 이미 처리된 노드는 제외
            if (state.processedNodes.has(node)) {
              return NodeFilter.FILTER_REJECT;
            }
            
            // 스크립트, 스타일, 숨겨진 요소 내 텍스트는 제외
            if (node.parentNode) {
              const parentTag = node.parentNode.tagName ? node.parentNode.tagName.toLowerCase() : '';
              if (parentTag === 'script' || parentTag === 'style' || parentTag === 'noscript' || 
                  parentTag === 'code' || parentTag === 'pre') {
                return NodeFilter.FILTER_REJECT;
              }
              
              // CSS로 숨겨진 요소 제외
              if (node.parentNode.nodeType === Node.ELEMENT_NODE) {
                const style = window.getComputedStyle(node.parentNode);
                if (style.display === 'none' || style.visibility === 'hidden') {
                  return NodeFilter.FILTER_REJECT;
                }
              }
            }
            
            // 텍스트 노드이고 내용이 있는 경우
            if (node.nodeType === Node.TEXT_NODE) {
              const text = node.textContent.trim();
              if (text.length > 0) {
                return NodeFilter.FILTER_ACCEPT;
              }
              return NodeFilter.FILTER_SKIP;
            }
            
            // 특정 속성(title, alt, placeholder 등)을 가진 요소 노드
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.hasAttribute('title') || node.hasAttribute('alt') || 
                  node.hasAttribute('placeholder') || 
                  (node.tagName === 'INPUT' && node.type !== 'password' && node.hasAttribute('value'))) {
                return NodeFilter.FILTER_ACCEPT;
              }
            }
            
            return NodeFilter.FILTER_SKIP;
          }
        }
      );
      
      // TreeWalker로 노드 탐색
      let node;
      while (node = walker.nextNode()) {
        // 노드가 화면에 보이는지 확인
        if (isNodeVisible(node)) {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            if (text && text.length >= settings.minTextLength) {
              visibleNodes.push({
                node,
                text,
                xpath: getXPathForNode(node),
                type: 'text'
              });
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            // 속성에 있는 텍스트 (alt, title, placeholder 등)
            ['title', 'alt', 'placeholder', 'value'].forEach(attr => {
              if (node.hasAttribute(attr) && node.getAttribute(attr).trim().length >= settings.minTextLength) {
                visibleNodes.push({
                  node,
                  text: node.getAttribute(attr),
                  xpath: `${getXPathForElement(node)}|attr:${attr}`,
                  type: 'attribute',
                  attribute: attr
                });
              }
            });
          }
          
          // 처리된 노드로 표시
          state.processedNodes.add(node);
        }
      }
      
      return visibleNodes;
    }
    
    /**
     * 노드가 현재 화면에 보이는지 확인
     * @private
     * @param {Node} node - 확인할 노드
     * @returns {boolean} - 노드가 보이는지 여부
     */
    function isNodeVisible(node) {
      // 텍스트 노드인 경우 부모 요소 확인
      const element = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
      
      // 요소가 없는 경우
      if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
      
      // 요소의 화면 위치 확인
      const rect = element.getBoundingClientRect();
      
      // 화면을 벗어난 경우
      if (rect.top > window.innerHeight || rect.bottom < 0 ||
          rect.left > window.innerWidth || rect.right < 0) {
        return false;
      }
      
      return true;
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
     * 번역된 텍스트를 DOM에 적용
     * @param {Array} translatedItems - [{original, translated, xpath}] 형태의 번역 항목
     * @returns {number} - 교체된 텍스트 수
     */
    function replaceTextsInDOM(translatedItems) {
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
      
      console.log(`[번역 익스텐션] ${replacedCount}개 텍스트 교체 완료`);
      return replacedCount;
    }
    
    /**
     * 스크롤 이벤트 리스너 설정
     * @param {Function} callback - 스크롤 후 호출될 콜백 함수
     */
    function setupScrollListener(callback) {
      // 이미 리스너가 있다면 추가하지 않음
      if (window.hasScrollListener) return;
      
      const handleScroll = () => {
        // 이미 타이머가 있으면 초기화
        if (state.scrollTimer) {
          clearTimeout(state.scrollTimer);
        }
        
        // 스크롤 종료 후 일정 시간 후에 콜백 수행
        state.scrollTimer = setTimeout(() => {
          // 현재 스크롤 위치가 이전과 충분히 다른 경우만 처리
          const currentScrollY = window.scrollY;
          if (Math.abs(currentScrollY - state.lastScrollPosition) > settings.scrollThreshold) {
            state.lastScrollPosition = currentScrollY;
            
            // 번역 중이 아닐 때만 콜백 실행
          if (!state.isTranslating && typeof callback === 'function') {
            callback();
          }
        }
      }, 500); // 스크롤 종료 후 500ms 대기
    };
    
    window.addEventListener('scroll', handleScroll);
    window.hasScrollListener = true;
    
    console.log("[번역 익스텐션] 스크롤 감지 활성화");
    
    // 페이지 언로드 시 리스너 제거
    window.addEventListener('beforeunload', () => {
      window.removeEventListener('scroll', handleScroll);
      window.hasScrollListener = false;
    });
    
    return handleScroll; // 리스너 함수 반환 (제거 시 사용)
  }
  
  /**
   * 스크롤 리스너 제거
   */
  function removeScrollListener() {
    if (window.hasScrollListener) {
      window.removeEventListener('scroll', window.scrollHandler);
      window.hasScrollListener = false;
      console.log("[번역 익스텐션] 스크롤 감지 비활성화");
    }
  }
  
  /**
   * 번역 UI 상태 표시 요소 생성 및 표시
   * @param {string} message - 표시할 메시지
   * @param {boolean} isComplete - 완료 상태 여부
   * @returns {HTMLElement} - 생성된 상태 요소
   */
  function showTranslationStatus(message, isComplete = false) {
    let statusElement = document.getElementById('translation-status-bar');
    
    if (!statusElement) {
      statusElement = document.createElement('div');
      statusElement.id = 'translation-status-bar';
      
      // 스타일 설정
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
        transition: 'all 0.3s ease'
      });
      
      document.body.appendChild(statusElement);
    } else {
      // 완료 상태일 경우 색상 변경
      if (isComplete) {
        statusElement.style.background = '#4CAF50';
      } else {
        statusElement.style.background = '#2196F3';
      }
    }
    
    statusElement.textContent = message;
    return statusElement;
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
  }
  
  /**
   * 번역 한도 초과 알림 표시
   * @param {Function} onUpgradeClick - 업그레이드 버튼 클릭 시 콜백
   */
  function showTranslationLimitExceeded(onUpgradeClick) {
    let limitElement = document.getElementById('translation-limit-exceeded');
    
    if (!limitElement) {
      limitElement = document.createElement('div');
      limitElement.id = 'translation-limit-exceeded';
      
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
      
      // 한도 초과 메시지
      limitElement.innerHTML = `
        <p><strong>번역 한도 초과!</strong></p>
        <p>이번 달 번역 한도를 모두 사용했습니다.</p>
        <p>더 많은 번역을 위해 구독 등급을 업그레이드하세요.</p>
        <button id="upgrade-subscription" style="
          background: white;
          color: #f44336;
          border: none;
          padding: 8px 15px;
          margin-top: 10px;
          border-radius: 3px;
          cursor: pointer;
          font-weight: bold;
        ">업그레이드</button>
      `;
      
      document.body.appendChild(limitElement);
      
      // 업그레이드 버튼 클릭 이벤트
      const upgradeButton = document.getElementById('upgrade-subscription');
      if (upgradeButton) {
        upgradeButton.addEventListener('click', () => {
          // 콜백 실행
          if (typeof onUpgradeClick === 'function') {
            onUpgradeClick();
          }
          
          // 알림 숨기기
          limitElement.style.display = 'none';
        });
      }
      
      // 10초 후 알림 자동 숨김
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
      }, 10000);
      
      return limitElement;
    }
    
    return limitElement;
  }
  
  /**
   * 번역 상태 설정
   * @param {boolean} isTranslating - 번역 중 상태
   */
  function setTranslatingState(isTranslating) {
    state.isTranslating = isTranslating;
  }
  
  /**
   * 번역 상태 가져오기
   * @returns {boolean} - 번역 중 상태
   */
  function getTranslatingState() {
    return state.isTranslating;
  }
  
  /**
   * 처리된 노드 목록 초기화
   */
  function resetProcessedNodes() {
    state.processedNodes = new WeakSet();
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
    extractVisibleTextNodes,
    replaceTextsInDOM,
    setupScrollListener,
    removeScrollListener,
    showTranslationStatus,
    hideTranslationStatus,
    showTranslationLimitExceeded,
    getElementByXPath,
    setTranslatingState,
    getTranslatingState,
    resetProcessedNodes,
    updateSettings,
    getSettings
  };
})();

// 모듈 내보내기
window.DOMHandler = DOMHandler;