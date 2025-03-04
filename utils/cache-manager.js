// utils/cache-manager.js
const CacheManager = (function() {
  'use strict';
  
  // 캐시 설정
  const CACHE_SETTINGS = {
    expiryDays: 30,   // 캐시 만료일 (일)
    keyPrefix: 'translate_' // 캐시 키 접두사
  };
  
  /**
   * 캐시에서 번역 가져오기
   * @param {string} text - 원본 텍스트
   * @param {string} targetLang - 대상 언어 코드
   * @returns {Promise<string|null>} - 캐시된 번역 또는 null
   */
  async function get(text, targetLang) {
    const key = _getCacheKey(text, targetLang);
    
    try {
      const data = await new Promise((resolve) => {
        chrome.storage.local.get(key, (result) => {
          resolve(result[key]);
        });
      });
      
      if (!data) return null;
      
      // 만료 시간 확인
      if (data.timestamp && Date.now() - data.timestamp > CACHE_SETTINGS.expiryDays * 24 * 60 * 60 * 1000) {
        await remove(text, targetLang);
        return null;
      }
      
      console.log(`[번역 익스텐션] 캐시에서 번역 불러옴: ${text.substring(0, 20)}...`);
      return data.translation;
    } catch (e) {
      console.error("캐시 읽기 오류:", e);
      return null;
    }
  }
  
  /**
   * 번역 결과를 캐시에 저장
   * @param {string} text - 원본 텍스트
   * @param {string} translation - 번역된 텍스트
   * @param {string} targetLang - 대상 언어 코드
   */
  function set(text, translation, targetLang) {
    const key = _getCacheKey(text, targetLang);
    const data = {
      translation,
      timestamp: Date.now() // 현재 시간 기록
    };
    
    chrome.storage.local.set({ [key]: data });
  }
  
  /**
   * 캐시에서 번역 제거
   * @param {string} text - 원본 텍스트
   * @param {string} targetLang - 대상 언어 코드
   */
  function remove(text, targetLang) {
    const key = _getCacheKey(text, targetLang);
    return new Promise((resolve) => {
      chrome.storage.local.remove(key, () => {
        resolve();
      });
    });
  }
  
  /**
   * 캐시 검색 키 생성
   * @private
   * @param {string} text - 원본 텍스트
   * @param {string} targetLang - 대상 언어 코드
   * @returns {string} - 캐시 키
   */
  function _getCacheKey(text, targetLang) {
    // 텍스트에서 공백 제거하고 해시 생성 (단순화된 해싱)
    const simpleHash = text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .split('')
      .reduce((hash, char) => ((hash << 5) - hash) + char.charCodeAt(0), 0)
      .toString(36);
    
    return `${CACHE_SETTINGS.keyPrefix}${targetLang}_${simpleHash}`;
  }
  
  /**
   * 캐시 통계 가져오기
   * @returns {Promise<Object>} - 캐시 통계 (count, size)
   */
  async function getStats() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        const cacheKeys = Object.keys(items).filter(key => key.startsWith(CACHE_SETTINGS.keyPrefix));
        resolve({
          count: cacheKeys.length,
          size: JSON.stringify(items).length
        });
      });
    });
  }
  
  /**
   * 오래된 캐시 정리
   * @returns {Promise<number>} - 삭제된 항목 수
   */
  async function cleanupExpired() {
    const now = Date.now();
    const expiryTime = CACHE_SETTINGS.expiryDays * 24 * 60 * 60 * 1000;
    
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        const expiredKeys = Object.keys(items)
          .filter(key => key.startsWith(CACHE_SETTINGS.keyPrefix) && 
                  items[key].timestamp && 
                  (now - items[key].timestamp > expiryTime));
        
        if (expiredKeys.length > 0) {
          chrome.storage.local.remove(expiredKeys, () => {
            console.log(`[번역 익스텐션] ${expiredKeys.length}개의 만료된 캐시 항목 삭제`);
            resolve(expiredKeys.length);
          });
        } else {
          resolve(0);
        }
      });
    });
  }
  
  /**
   * 캐시 설정 업데이트
   * @param {Object} newSettings - 새 설정 값
   */
  function updateSettings(newSettings) {
    Object.assign(CACHE_SETTINGS, newSettings);
  }
  
  /**
   * 현재 캐시 설정 가져오기
   * @returns {Object} - 현재 캐시 설정
   */
  function getSettings() {
    return {...CACHE_SETTINGS};
  }
  
  // 공개 API
  return {
    get,
    set,
    remove,
    getStats,
    cleanupExpired,
    updateSettings,
    getSettings
  };
})();

// 모듈 내보내기
window.CacheManager = CacheManager;