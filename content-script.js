// content-script.js
// 코어 기능 구현: 1~5번 항목 + Gemini API 번역 기능

// 설정값 (실제 환경에서는 storage API로 관리)
const SETTINGS = {
  apiKey: '123123', // Gemini API 키 (임시값)
  targetLang: 'ko', // 대상 언어 (한국어)
  batchSize: 5,     // 한 번에 처리할 텍스트 배치 크기
  maxConcurrent: 3  // 최대 동시 요청 수
};

// 백그라운드 스크립트로부터 메시지 수신
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "translatePage") {
    translatePage().then(result => {
      sendResponse({ success: true, result });
    }).catch(error => {
      console.error("[번역 익스텐션] 오류:", error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // 비동기 응답을 위해 true 반환
  }
});

/**
 * 1. 웹페이지 전체를 가져와 번역 프로세스 시작
 * 2. 자연어 텍스트만 추출
 * 3. 리스트에 [원본텍스트, 번역될 텍스트, 위치정보] 저장
 * 4. Gemini API로 번역 요청
 * 5. 번역된 텍스트를 DOM에 적용
 */
async function translatePage() {
  console.log("[번역 익스텐션] 페이지 번역 시작");
  
  // 번역 진행 상태 표시
  showTranslationStatus("번역 준비 중...");
  
  try {
    // 2. 자연어 텍스트 추출
    const textNodes = extractTextNodes(document.body);
    console.log(`[번역 익스텐션] 추출된 텍스트 노드: ${textNodes.length}개`);
    
    // 3. 텍스트 정보 리스트 생성 [원본텍스트, 빈칸(번역될 공간), 위치정보]
    const textList = [];
    
    textNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        if (text && text.length > 1) { // 1글자 미만은 건너뜀
          // XPath로 위치 정보 저장
          const xpath = getXPathForNode(node);
          textList.push([text, "", xpath]);
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // 속성에 있는 텍스트 (alt, title, placeholder 등)
        ['title', 'alt', 'placeholder', 'value'].forEach(attr => {
          if (node.hasAttribute(attr) && node.getAttribute(attr).trim().length > 1) {
            const attrValue = node.getAttribute(attr);
            const attrInfo = `${getXPathForElement(node)}|attr:${attr}`;
            textList.push([attrValue, "", attrInfo]);
          }
        });
      }
    });
    
    console.log(`[번역 익스텐션] 번역할 텍스트 항목: ${textList.length}개`);
    
    if (textList.length === 0) {
      hideTranslationStatus();
      return "번역할 텍스트가 없습니다.";
    }
    
    // 4. Gemini API로 번역
    showTranslationStatus(`총 ${textList.length}개 항목 번역 중...`);
    
    // 텍스트 배치로 나누기
    const batches = [];
    for (let i = 0; i < textList.length; i += SETTINGS.batchSize) {
      batches.push(textList.slice(i, i + SETTINGS.batchSize));
    }
    
    let completedCount = 0;
    const translatedTexts = [];
    
    // 제한된 동시 요청 수로 배치 처리
    for (let i = 0; i < batches.length; i += SETTINGS.maxConcurrent) {
      const currentBatch = batches.slice(i, i + SETTINGS.maxConcurrent);
      const batchPromises = currentBatch.map(batch => translateTextBatch(batch));
      
      const batchResults = await Promise.all(batchPromises);
      
      batchResults.forEach(results => {
        translatedTexts.push(...results);
        completedCount += results.length;
        showTranslationStatus(`${completedCount}/${textList.length} 항목 번역 완료...`);
      });
    }
    
    // 5. 번역된 텍스트를 DOM에 적용
    showTranslationStatus("번역 결과 적용 중...");
    replaceTextsInDOM(translatedTexts);
    
    // 완료 메시지 표시 후 상태 UI 숨기기
    showTranslationStatus("번역 완료!", true);
    setTimeout(() => {
      hideTranslationStatus();
    }, 2000);
    
    return `${translatedTexts.length}개 항목 번역 완료`;
  } catch (error) {
    hideTranslationStatus();
    console.error("[번역 익스텐션] 번역 오류:", error);
    throw error;
  }
}

/**
 * Gemini API로 텍스트 배치 번역
 * @param {Array} textBatch 번역할 텍스트 배치 [[원본, "", 위치], ...]
 * @returns {Promise<Array>} 번역된 텍스트 배치 [[원본, 번역, 위치], ...]
 */
async function translateTextBatch(textBatch) {
  try {
    // 원본 텍스트만 추출
    const originalTexts = textBatch.map(item => item[0]);
    
    // Gemini API 요청 데이터 구성
    const promptText = `다음 텍스트들을 ${SETTINGS.targetLang === 'ko' ? '한국어' : '대상 언어'}로 자연스럽게 번역해주세요. 
각 텍스트는 번역만 해주고 다른 설명은 하지 말아주세요. 줄바꿈으로 구분된 번역 결과만 주세요.

${originalTexts.join('\n')}`;

    // Gemini API 호출
    const translatedTexts = await callGeminiAPI(promptText);
    
    // 응답 텍스트 처리
    const translations = processTranslations(translatedTexts, originalTexts.length);
    
    // 배치 결과 구성 [원본, 번역, 위치]
    return textBatch.map((item, index) => {
      return [item[0], translations[index] || item[0], item[2]];
    });
  } catch (error) {
    console.error("[번역 익스텐션] 배치 번역 오류:", error);
    // 오류 발생 시 원본 텍스트 반환
    return textBatch.map(item => [item[0], item[0], item[2]]);
  }
}

/**
 * Gemini API 호출 함수
 * @param {string} prompt Gemini에 전달할 프롬프트
 * @returns {Promise<string>} Gemini 응답 텍스트
 */
async function callGeminiAPI(prompt) {  
  try {
    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          topP: 0.8,
          topK: 40
        }
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Gemini API 오류: ${errorData.error?.message || response.statusText}`);
    }
    
    const data = await response.json();
    
    // 응답 텍스트 추출
    if (data.candidates && data.candidates.length > 0 && 
        data.candidates[0].content && data.candidates[0].content.parts) {
      return data.candidates[0].content.parts[0].text;
    } else {
      throw new Error("Gemini API에서 유효한 응답을 받지 못했습니다.");
    }
  } catch (error) {
    console.error("[번역 익스텐션] Gemini API 호출 오류:", error);
    throw error;
  }
}

/**
 * 번역 응답 처리 함수
 * @param {string} translatedText Gemini에서 받은 텍스트
 * @param {number} expectedCount 예상되는 번역 수
 * @returns {Array<string>} 처리된 번역 배열
 */
function processTranslations(translatedText, expectedCount) {
  // 줄바꿈으로 분리
  const lines = translatedText.split('\n').filter(line => line.trim());
  
  // 예상 개수와 맞지 않으면 조정
  if (lines.length !== expectedCount) {
    console.warn(`[번역 익스텐션] 번역 결과 개수가 맞지 않습니다. 예상: ${expectedCount}, 실제: ${lines.length}`);
    
    // 부족한 경우 빈 문자열로 채움
    while (lines.length < expectedCount) {
      lines.push("");
    }
    
    // 초과하는 경우 잘라냄
    if (lines.length > expectedCount) {
      lines.splice(expectedCount);
    }
  }
  
  return lines;
}

/**
 * 2. DOM에서 텍스트 노드 추출
 */
function extractTextNodes(element) {
  const textNodes = [];
  
  // TreeWalker를 사용하여 텍스트 노드와 특정 속성을 가진 요소 노드 탐색
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: function(node) {
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
    textNodes.push(node);
  }
  
  return textNodes;
}

/**
 * 3. 텍스트 노드의 XPath 생성 (위치 정보)
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
 * 3. 요소의 XPath 생성 (위치 정보)
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
 * 5. 번역된 텍스트를 DOM에 적용
 */
function replaceTextsInDOM(translatedTexts) {
  console.log(`[번역 익스텐션] ${translatedTexts.length}개 텍스트 교체 시작`);
  
  let replacedCount = 0;
  translatedTexts.forEach(item => {
    try {
      const [originalText, translatedText, locationInfo] = item;
      
      // 번역되지 않았거나 원본과 동일한 텍스트는 건너뜀
      if (!translatedText || originalText === translatedText) {
        return;
      }
      
      // 속성인 경우 (xpath|attr:속성명)
      if (locationInfo.includes('|attr:')) {
        const [xpath, attrInfo] = locationInfo.split('|attr:');
        const attrName = attrInfo;
        const element = getElementByXPath(xpath);
        
        if (element && element.hasAttribute(attrName)) {
          element.setAttribute(attrName, translatedText);
          replacedCount++;
        }
      } 
      // 텍스트 노드인 경우
      else {
        const textNode = getElementByXPath(locationInfo);
        if (textNode && textNode.nodeType === Node.TEXT_NODE) {
          textNode.textContent = translatedText;
          replacedCount++;
        }
      }
    } catch (error) {
      console.error("[번역 익스텐션] 텍스트 교체 오류:", error);
    }
  });
  
  console.log(`[번역 익스텐션] ${replacedCount}개 텍스트 교체 완료`);
}

/**
 * 5. XPath로 요소 찾기
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
 * 번역 상태 UI 생성 및 표시
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
    }
  }
  
  statusElement.textContent = message;
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

// 현재 페이지 언어 감지 및 자동 번역 시작 (임시 비활성화)
// if (document.readyState === 'complete') {
//   detectPageLanguage();
// } else {
//   window.addEventListener('load', detectPageLanguage);
// }
