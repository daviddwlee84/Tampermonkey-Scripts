// ==UserScript==
// @name         Vimium C Companion
// @namespace    https://github.com/daviddwlee84/Tampermonkey-Scripts
// @version      0.1.0
// @description  Vimium C 個人鍵位小抄、設定匯入與操作流程，陪你練習原生鍵盤導覽
// @author       Da-Wei Lee
// @license      MIT AND Apache-2.0
// @match        https://*/*
// @match        http://*/*
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9ImhzbCg3NiA2MiUgNDYlKSIvPjx0ZXh0IHg9IjMyIiB5PSIzMyIgZmlsbD0iI2ZmZiIgZm9udC1mYW1pbHk9IkhlbHZldGljYSxBcmlhbCxzYW5zLXNlcmlmIiBmb250LXNpemU9IjI3IiBmb250LXdlaWdodD0iNzAwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkb21pbmFudC1iYXNlbGluZT0iY2VudHJhbCI+VkM8L3RleHQ+PC9zdmc+
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/vimium-c-companion/vimium-c-companion.user.js
// @downloadURL  https://raw.githubusercontent.com/daviddwlee84/Tampermonkey-Scripts/main/userscripts/vimium-c-companion/vimium-c-companion.user.js
// ==/UserScript==

/*
 * Vimium C Companion 的原創程式碼：MIT，Copyright (c) Da-Wei Lee。
 * 內建命令、預設鍵位與 i18n help 資料取自 Vimium C 2.12.2，
 * Copyright 2023-present Gong Dahan，Apache-2.0。
 * 本版修改：靜態資料抽出、分類整理、個人鍵位預覽與小抄呈現；未引入原生 runtime。
 * 上游：https://github.com/gdh1995/vimium-c
 * 下列授權隨 raw userscript 一併分發。

原創程式碼授權：
MIT License

Copyright (c) 2026 Da-Wei Lee

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Vimium C 資料授權：
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Portions Copyright (c) Microsoft Corporation.
   Portions Copyright 2017 Google Inc.

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.

*/

(function () {
  'use strict';

  /* REFERENCE MODEL START */

  function createReferenceModel() {
    'use strict';
    // 2.12.2 官方安裝包的靜態命令資料；對照下列固定 upstream commit，未執行或匯入其 runtime。
    const source = {
      version: '2.12.2',
      commit: '9e780336ee36ef947e76258e2018cceb69de7e4f',
      url: 'https://github.com/gdh1995/vimium-c/tree/9e780336ee36ef947e76258e2018cceb69de7e4f',
      provenance: 'official-2.12.2-package',
      artifactHash: '37ba26759c4377c178652a2ac06dab22cee31d1aa5e2dce8f7b27831ae887963',
    };
    const categories = [
      { id: 'navigation', title: '頁面導航與複製' },
      { id: 'hints', title: '連結提示與 Hover' },
      { id: 'find', title: '頁內搜尋' },
      { id: 'visual', title: 'Visual 文字操作' },
      { id: 'tabs', title: '分頁與視窗' },
      { id: 'vomnibar', title: 'Vomnibar' },
      { id: 'coexist', title: '網站快捷鍵與共存' },
      { id: 'advanced', title: '進階與自訂流程' },
    ];
    const nativeRows = [
      {
        id: 'LinkHints.activate',
        title: '點擊網頁中的連結和按鈕',
        description: '點擊網頁中的連結和按鈕。可用參數：button=""/right, touch=false/true/"auto"',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: ['f'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activate',
      },
      {
        id: 'LinkHints.activateCopyImage',
        title: '複製圖片到剪貼簿',
        description: '複製圖片到剪貼簿。可用參數：richText=safe',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: ['yi'],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateCopyImage',
      },
      {
        id: 'LinkHints.activateCopyLinkText',
        title: '複製連結的文字內容',
        description: '複製連結的文字內容。可用參數：join:boolean/string',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateCopyLinkText',
      },
      {
        id: 'LinkHints.activateCopyLinkUrl',
        title: '複製連結的網址',
        description: '複製連結的網址',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: ['yf'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateCopyLinkUrl',
      },
      {
        id: 'LinkHints.activateDownloadImage',
        title: '下載圖片或影音文件',
        description: '下載圖片或影音文件',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateDownloadImage',
      },
      {
        id: 'LinkHints.activateDownloadLink',
        title: '下載任意連結',
        description: '下載任意連結',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateDownloadLink',
      },
      {
        id: 'LinkHints.activateEdit',
        title: '選擇輸入框',
        description: '選擇輸入框',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateEdit',
      },
      {
        id: 'LinkHints.activateFocus',
        title: '移動焦點到網頁內容',
        description: '移動焦點到網頁內容',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateFocus',
      },
      {
        id: 'LinkHints.activateHover',
        title: '模擬鼠標移動到網頁內容上',
        description: '模擬鼠標移動到網頁內容上。可用參數：showUrl=true',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateHover',
      },
      {
        id: 'LinkHints.activateLeave',
        title: '模擬鼠標從網頁內容上移出',
        description: '模擬鼠標從網頁內容上移出',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateLeave',
      },
      {
        id: 'LinkHints.activateMode',
        title: '點擊網頁中的連結和按鈕',
        description:
          '點擊網頁中的連結和按鈕；原生別名：LinkHints.activate。可用參數：button=""/right, touch=false/true/"auto"',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activate',
      },
      {
        id: 'LinkHints.activateModeToCopyImage',
        title: '複製圖片到剪貼簿',
        description:
          '複製圖片到剪貼簿；原生別名：LinkHints.activateCopyImage。可用參數：richText=safe',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateCopyImage',
      },
      {
        id: 'LinkHints.activateModeToCopyLinkText',
        title: '複製連結的文字內容',
        description:
          '複製連結的文字內容；原生別名：LinkHints.activateCopyLinkText。可用參數：join:boolean/string',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateCopyLinkText',
      },
      {
        id: 'LinkHints.activateModeToCopyLinkUrl',
        title: '複製連結的網址',
        description: '複製連結的網址；原生別名：LinkHints.activateCopyLinkUrl',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateCopyLinkUrl',
      },
      {
        id: 'LinkHints.activateModeToDownloadImage',
        title: '下載圖片或影音文件',
        description: '下載圖片或影音文件；原生別名：LinkHints.activateDownloadImage',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateDownloadImage',
      },
      {
        id: 'LinkHints.activateModeToDownloadLink',
        title: '下載任意連結',
        description: '下載任意連結；原生別名：LinkHints.activateDownloadLink',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateDownloadLink',
      },
      {
        id: 'LinkHints.activateModeToEdit',
        title: '選擇輸入框',
        description: '選擇輸入框；原生別名：LinkHints.activateEdit',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateEdit',
      },
      {
        id: 'LinkHints.activateModeToFocus',
        title: '移動焦點到網頁內容',
        description: '移動焦點到網頁內容；原生別名：LinkHints.activateFocus',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateFocus',
      },
      {
        id: 'LinkHints.activateModeToHover',
        title: '模擬鼠標移動到網頁內容上',
        description:
          '模擬鼠標移動到網頁內容上；原生別名：LinkHints.activateHover。可用參數：showUrl=true',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateHover',
      },
      {
        id: 'LinkHints.activateModeToLeave',
        title: '模擬鼠標從網頁內容上移出',
        description: '模擬鼠標從網頁內容上移出；原生別名：LinkHints.activateLeave',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateLeave',
      },
      {
        id: 'LinkHints.activateModeToOpenImage',
        title: '顯示圖片',
        description: '顯示圖片；原生別名：LinkHints.activateOpenImage。可用參數：auto=true',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateOpenImage',
      },
      {
        id: 'LinkHints.activateModeToOpenIncognito',
        title: '在無痕視窗中打開連結',
        description: '在無痕視窗中打開連結；原生別名：LinkHints.activateOpenIncognito',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateOpenIncognito',
      },
      {
        id: 'LinkHints.activateModeToOpenInNewForegroundTab',
        title: '在新分頁中打開連結',
        description: '在新分頁中打開連結；原生別名：LinkHints.activateOpenInNewForegroundTab',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateOpenInNewForegroundTab',
      },
      {
        id: 'LinkHints.activateModeToOpenInNewTab',
        title: '在新分頁中打開連結（不跳轉到）',
        description: '在新分頁中打開連結（不跳轉到）；原生別名：LinkHints.activateOpenInNewTab',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateOpenInNewTab',
      },
      {
        id: 'LinkHints.activateModeToOpenUrl',
        title: '直接打開連結網址而不模擬鼠標動作',
        description: '直接打開連結網址而不模擬鼠標動作；原生別名：LinkHints.activateOpenUrl',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateOpenUrl',
      },
      {
        id: 'LinkHints.activateModeToOpenVomnibar',
        title: '用搜尋框編輯連結的文字內容',
        description:
          '用搜尋框編輯連結的文字內容；原生別名：LinkHints.activateOpenVomnibar。可用參數：url, newtab, then:{}',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateOpenVomnibar',
      },
      {
        id: 'LinkHints.activateModeToSearchLinkText',
        title: '搜尋連結的文字',
        description: '搜尋連結的文字；原生別名：LinkHints.activateSearchLinkText',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateSearchLinkText',
      },
      {
        id: 'LinkHints.activateModeToSelect',
        title: '選擇文字以進入自由選擇模式',
        description:
          '選擇文字以進入自由選擇模式；原生別名：LinkHints.activateSelect。可用參數：visual=true, caret, then:{}',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateSelect',
      },
      {
        id: 'LinkHints.activateModeToUnhover',
        title: '模擬鼠標從網頁內容上移出',
        description: '模擬鼠標從網頁內容上移出；原生別名：LinkHints.activateLeave',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateLeave',
      },
      {
        id: 'LinkHints.activateModeWithQueue',
        title: '連續點擊網頁中的連結和按鈕',
        description: '連續點擊網頁中的連結和按鈕；原生別名：LinkHints.activateWithQueue',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateWithQueue',
      },
      {
        id: 'LinkHints.activateOpenImage',
        title: '顯示圖片',
        description: '顯示圖片。可用參數：auto=true',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateOpenImage',
      },
      {
        id: 'LinkHints.activateOpenIncognito',
        title: '在無痕視窗中打開連結',
        description: '在無痕視窗中打開連結',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateOpenIncognito',
      },
      {
        id: 'LinkHints.activateOpenInNewForegroundTab',
        title: '在新分頁中打開連結',
        description: '在新分頁中打開連結',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateOpenInNewForegroundTab',
      },
      {
        id: 'LinkHints.activateOpenInNewTab',
        title: '在新分頁中打開連結（不跳轉到）',
        description: '在新分頁中打開連結（不跳轉到）',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: ['F'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateOpenInNewTab',
      },
      {
        id: 'LinkHints.activateOpenUrl',
        title: '直接打開連結網址而不模擬鼠標動作',
        description: '直接打開連結網址而不模擬鼠標動作',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateOpenUrl',
      },
      {
        id: 'LinkHints.activateOpenVomnibar',
        title: '用搜尋框編輯連結的文字內容',
        description: '用搜尋框編輯連結的文字內容。可用參數：url, newtab, then:{}',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateOpenVomnibar',
      },
      {
        id: 'LinkHints.activateSearchLinkText',
        title: '搜尋連結的文字',
        description: '搜尋連結的文字',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateSearchLinkText',
      },
      {
        id: 'LinkHints.activateSelect',
        title: '選擇文字以進入自由選擇模式',
        description: '選擇文字以進入自由選擇模式。可用參數：visual=true, caret, then:{}',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: ['yv'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateSelect',
      },
      {
        id: 'LinkHints.activateUnhover',
        title: '模擬鼠標從網頁內容上移出',
        description: '模擬鼠標從網頁內容上移出；原生別名：LinkHints.activateLeave',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateLeave',
      },
      {
        id: 'LinkHints.activateWithQueue',
        title: '連續點擊網頁中的連結和按鈕',
        description: '連續點擊網頁中的連結和按鈕',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: ['<a-f>'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.activateWithQueue',
      },
      {
        id: 'LinkHints.click',
        title: '點擊選中文字、當前鍵盤焦點或最近一次點擊的對象',
        description:
          '點擊選中文字、當前鍵盤焦點或最近一次點擊的對象。可用參數：direct=true|element|sel|focus|click|sel,focus,click',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.click',
      },
      {
        id: 'LinkHints.unhoverLast',
        title: '模擬鼠標從上一次點擊的對象上移出',
        description: '模擬鼠標從上一次點擊的對象上移出',
        category: 'hints',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'LinkHints.unhoverLast',
      },
      {
        id: 'Marks.activate',
        title: '跳轉到指定標記',
        description: '跳轉到指定標記。可用參數：prefix=true, swap, mapKey',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['`'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Marks.activate',
      },
      {
        id: 'Marks.activateCreate',
        title: '創建一個新標記',
        description: '創建一個新標記。可用參數：swap',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['m'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Marks.activateCreate',
      },
      {
        id: 'Marks.activateCreateMode',
        title: '創建一個新標記',
        description: '創建一個新標記；原生別名：Marks.activateCreate。可用參數：swap',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Marks.activateCreate',
      },
      {
        id: 'Marks.activateGoto',
        title: '跳轉到指定標記',
        description:
          '跳轉到指定標記；原生別名：Marks.activate。可用參數：prefix=true, swap, mapKey',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Marks.activate',
      },
      {
        id: 'Marks.activateGotoMode',
        title: '跳轉到指定標記',
        description:
          '跳轉到指定標記；原生別名：Marks.activate。可用參數：prefix=true, swap, mapKey',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Marks.activate',
      },
      {
        id: 'Marks.clearGlobal',
        title: '清理所有全局標記',
        description: '清理所有全局標記',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Marks.clearGlobal',
      },
      {
        id: 'Marks.clearLocal',
        title: '清理當前網頁下的所有標記',
        description: '清理當前網頁下的所有標記',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Marks.clearLocal',
      },
      {
        id: 'Vomnibar.activate',
        title: '顯示多功能搜尋框',
        description: '顯示多功能搜尋框。可用參數：keyword="", url:boolean/string',
        category: 'vomnibar',
        kind: 'command',
        mode: 'normal',
        keys: ['o'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Vomnibar.activate',
      },
      {
        id: 'Vomnibar.activateBookmarks',
        title: '顯示搜尋框並搜尋書籤的內容',
        description: '顯示搜尋框並搜尋書籤的內容',
        category: 'vomnibar',
        kind: 'command',
        mode: 'normal',
        keys: ['b'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Vomnibar.activateBookmarks',
      },
      {
        id: 'Vomnibar.activateBookmarksInNewTab',
        title: '搜尋書籤的內容並在新分頁打開',
        description: '搜尋書籤的內容並在新分頁打開',
        category: 'vomnibar',
        kind: 'command',
        mode: 'normal',
        keys: ['B'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Vomnibar.activateBookmarksInNewTab',
      },
      {
        id: 'Vomnibar.activateEditUrl',
        title: '顯示搜尋框並編輯當前網址',
        description: '顯示搜尋框並編輯當前網址',
        category: 'vomnibar',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Vomnibar.activateEditUrl',
      },
      {
        id: 'Vomnibar.activateEditUrlInNewTab',
        title: '編輯當前網址並在新分頁打開',
        description: '編輯當前網址並在新分頁打開',
        category: 'vomnibar',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Vomnibar.activateEditUrlInNewTab',
      },
      {
        id: 'Vomnibar.activateHistory',
        title: '顯示搜尋框並搜尋歷史記錄',
        description: '顯示搜尋框並搜尋歷史記錄',
        category: 'vomnibar',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Vomnibar.activateHistory',
      },
      {
        id: 'Vomnibar.activateHistoryInNewTab',
        title: '搜尋歷史記錄並在新分頁打開',
        description: '搜尋歷史記錄並在新分頁打開',
        category: 'vomnibar',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Vomnibar.activateHistoryInNewTab',
      },
      {
        id: 'Vomnibar.activateInNewTab',
        title: '搜尋混合內容並在新分頁打開',
        description: '搜尋混合內容並在新分頁打開。可用參數：keyword, url',
        category: 'vomnibar',
        kind: 'command',
        mode: 'normal',
        keys: ['O'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Vomnibar.activateInNewTab',
      },
      {
        id: 'Vomnibar.activateTabs',
        title: '在所有分頁中搜尋',
        description: '在所有分頁中搜尋',
        category: 'vomnibar',
        kind: 'command',
        mode: 'normal',
        keys: ['T'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Vomnibar.activateTabs',
      },
      {
        id: 'Vomnibar.activateTabSelection',
        title: '在所有分頁中搜尋',
        description: '在所有分頁中搜尋；原生別名：Vomnibar.activateTabs',
        category: 'vomnibar',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Vomnibar.activateTabs',
      },
      {
        id: 'Vomnibar.activateUrl',
        title: '顯示搜尋框並編輯當前網址',
        description: '顯示搜尋框並編輯當前網址；原生別名：Vomnibar.activateEditUrl',
        category: 'vomnibar',
        kind: 'command',
        mode: 'normal',
        keys: ['ge'],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Vomnibar.activateEditUrl',
      },
      {
        id: 'Vomnibar.activateUrlInNewTab',
        title: '編輯當前網址並在新分頁打開',
        description: '編輯當前網址並在新分頁打開；原生別名：Vomnibar.activateEditUrlInNewTab',
        category: 'vomnibar',
        kind: 'command',
        mode: 'normal',
        keys: ['gE'],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'Vomnibar.activateEditUrlInNewTab',
      },
      {
        id: 'addBookmark',
        title: '將分頁添加到書籤',
        description: '將分頁添加到書籤。可用參數：folder:string',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'addBookmark',
      },
      {
        id: 'autoCopy',
        title: '複製選中文字、網頁標題或網址',
        description: '複製選中文字、網頁標題或網址。可用參數：text: string, url, decoded',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'autoCopy',
      },
      {
        id: 'autoOpen',
        title: '打開或搜尋選中文字或已複製的網址',
        description: '打開或搜尋選中文字或已複製的網址',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'autoOpen',
      },
      {
        id: 'blank',
        title: '空操作',
        description: '空操作',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'blank',
      },
      {
        id: 'captureTab',
        title: '對當前網頁的可視區域截圖',
        description: '對當前網頁的可視區域截圖',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'captureTab',
      },
      {
        id: 'clearContentSetting',
        title: '撤銷所有對網站的功能使用權限的修改',
        description: '撤銷所有對網站的功能使用權限的修改；原生別名：clearContentSettings',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'clearContentSettings',
      },
      {
        id: 'clearContentSettings',
        title: '撤銷所有對網站的功能使用權限的修改',
        description: '撤銷所有對網站的功能使用權限的修改',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'clearContentSettings',
      },
      {
        id: 'clearCS',
        title: '撤銷所有對網站的功能使用權限的修改',
        description: '撤銷所有對網站的功能使用權限的修改；原生別名：clearContentSettings',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'clearContentSettings',
      },
      {
        id: 'clearFindHistory',
        title: '清理頁內查詢功能中最近用過的詞語',
        description: '清理頁內查詢功能中最近用過的詞語',
        category: 'find',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'clearFindHistory',
      },
      {
        id: 'closeDownloadBar',
        title: '關閉視窗底部的下載進度欄',
        description: '關閉視窗底部的下載進度欄',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'closeDownloadBar',
      },
      {
        id: 'closeOtherTabs',
        title: '關閉當前視窗的其它所有分頁',
        description: '關閉當前視窗的其它所有分頁。可用參數：filter=""/url/url+hash/url+title',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'closeOtherTabs',
      },
      {
        id: 'closeSomeOtherTabs',
        title: '關閉當前視窗的其它所有分頁',
        description:
          '關閉當前視窗的其它所有分頁；原生別名：closeOtherTabs。可用參數：filter=""/url/url+hash/url+title',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'closeOtherTabs',
      },
      {
        id: 'closeTabsOnLeft',
        title: '關閉左側所有分頁',
        description: '關閉左側所有分頁。可用參數：$count=0',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'closeTabsOnLeft',
      },
      {
        id: 'closeTabsOnRight',
        title: '關閉右側所有分頁',
        description: '關閉右側所有分頁。可用參數：$count=0',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'closeTabsOnRight',
      },
      {
        id: 'confirm',
        title: '彈出確認對話框並等待',
        description: '彈出確認對話框並等待。可用參數：ask:string, $then, $else',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'confirm',
      },
      {
        id: 'copyCurrentTitle',
        title: '複製當前分頁的標題',
        description: '複製當前分頁的標題',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'copyCurrentTitle',
      },
      {
        id: 'copyCurrentUrl',
        title: '複製當前分頁或當前子頁面的網址或標題',
        description:
          '複製當前分頁或當前子頁面的網址或標題。可用參數：type=url/title/frame, decoded',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['yy'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'copyCurrentUrl',
      },
      {
        id: 'copyWindowInfo',
        title: '複製當前視窗所有分頁的標題和網址',
        description:
          '複製當前視窗所有分頁的標題和網址。可用參數：format="${title}: ${url}", join:true/string, decoded',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'copyWindowInfo',
      },
      {
        id: 'createTab',
        title: '打開新的分頁',
        description: '打開新的分頁',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: ['t', '<a-t>'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'createTab',
      },
      {
        id: 'debugBackground',
        title: '打開 Vimium C 擴充功能的管理頁',
        description: '打開 Vimium C 擴充功能的管理頁',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'debugBackground',
      },
      {
        id: 'discardTab',
        title: '暫時丟棄某個網頁以節約資源',
        description: '暫時丟棄某個網頁以節約資源',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'discardTab',
      },
      {
        id: 'dispatchEvent',
        title: '模擬觸發任意 DOM 事件',
        description: '模擬觸發任意 DOM 事件。可用參數：key="key,keyCode,code",init:{}',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'dispatchEvent',
      },
      {
        id: 'duplicateTab',
        title: '複製當前分頁',
        description: '複製當前分頁',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: ['yt'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'duplicateTab',
      },
      {
        id: 'editText',
        title: '向瀏覽器發送文字編輯指令',
        description: '向瀏覽器發送文字編輯指令。可用參數：run:string, dom=false',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'editText',
      },
      {
        id: 'enableContentSettingTemp',
        title: '在無痕視窗中授予網站對一項功能的使用權限',
        description: '在無痕視窗中授予網站對一項功能的使用權限',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'enableContentSettingTemp',
      },
      {
        id: 'enableCSTemp',
        title: '在無痕視窗中授予網站對一項功能的使用權限',
        description: '在無痕視窗中授予網站對一項功能的使用權限；原生別名：enableContentSettingTemp',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'enableContentSettingTemp',
      },
      {
        id: 'enterFindMode',
        title: '進入頁內查詢模式',
        description: '進入頁內查詢模式。可用參數：last, selected=true',
        category: 'find',
        kind: 'command',
        mode: 'normal',
        keys: ['/'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'enterFindMode',
      },
      {
        id: 'enterInsertMode',
        title: '暫停識別快速鍵，按 ESC 退出',
        description: '暫停識別快速鍵，按 ESC 退出。可用參數：key:string, unhover, reset',
        category: 'coexist',
        kind: 'command',
        mode: 'normal',
        keys: ['i'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'enterInsertMode',
      },
      {
        id: 'enterVisualLineMode',
        title: '進入文字選擇模式（對齊到行）',
        description: '進入文字選擇模式（對齊到行）',
        category: 'visual',
        kind: 'command',
        mode: 'normal',
        keys: ['V'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'enterVisualLineMode',
      },
      {
        id: 'enterVisualMode',
        title: '進入文字自由選擇模式',
        description: '進入文字自由選擇模式',
        category: 'visual',
        kind: 'command',
        mode: 'normal',
        keys: ['<f8>', 'v'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'enterVisualMode',
      },
      {
        id: 'findSelected',
        title: '查找選擇的詞語',
        description: '查找選擇的詞語。可用參數：selected=line/any/auto-line',
        category: 'find',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'findSelected',
      },
      {
        id: 'findSelectedBackwards',
        title: '向上查找選擇的詞語',
        description: '向上查找選擇的詞語',
        category: 'find',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'findSelectedBackwards',
      },
      {
        id: 'firstTab',
        title: '切換到左起指定位置的分頁',
        description: '切換到左起指定位置的分頁',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: ['g0'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'firstTab',
      },
      {
        id: 'focusInput',
        title: '進入輸入框選擇模式（Tab 切換）',
        description:
          '進入輸入框選擇模式（Tab 切換）。可用參數：keep, select=""/all/all-line/start/end',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['gi'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'focusInput',
      },
      {
        id: 'focusOrLaunch',
        title: '切換到或新建指定網址的分頁',
        description: '切換到或新建指定網址的分頁。可用參數：url:string, prefix',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'focusOrLaunch',
      },
      {
        id: 'goBack',
        title: '在歷史記錄中後退',
        description: '在歷史記錄中後退。可用參數：reuse=current/newBg/newFg',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['H'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'goBack',
      },
      {
        id: 'goForward',
        title: '在歷史記錄中前進',
        description: '在歷史記錄中前進',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['L'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'goForward',
      },
      {
        id: 'goNext',
        title: '自動識別並訪問下一個頁面',
        description:
          '自動識別並訪問下一個頁面。可用參數：sed=true, patterns:string, rel:string, noRel, isNext',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [']]'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'goNext',
      },
      {
        id: 'goPrevious',
        title: '自動識別並訪問上一個頁面',
        description: '自動識別並訪問上一個頁面',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['[['],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'goPrevious',
      },
      {
        id: 'goToRoot',
        title: '訪問當前網站的首頁',
        description: '訪問當前網站的首頁',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['gU'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'goToRoot',
      },
      {
        id: 'goUp',
        title: '訪問當前網址的上一層',
        description: '訪問當前網址的上一層。可用參數：trailingSlash=null/true/false',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['gu'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'goUp',
      },
      {
        id: 'joinTabs',
        title: '合併所有視窗',
        description: '合併所有視窗',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'joinTabs',
      },
      {
        id: 'lastTab',
        title: '切換到右起指定位置的分頁',
        description: '切換到右起指定位置的分頁',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: ['g$'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'lastTab',
      },
      {
        id: 'mainFrame',
        title: '移動鍵盤焦點到最外層頁面',
        description: '移動鍵盤焦點到最外層頁面',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['gF'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'mainFrame',
      },
      {
        id: 'moveTabLeft',
        title: '向左移動分頁',
        description: '向左移動分頁。可用參數：group=true',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: ['<<'],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'moveTabLeft',
      },
      {
        id: 'moveTabRight',
        title: '向右移動分頁',
        description: '向右移動分頁。可用參數：group=true',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: ['>>'],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'moveTabRight',
      },
      {
        id: 'moveTabToIncognito',
        title: '在無痕視窗中打開當前網頁',
        description: '在無痕視窗中打開當前網頁',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'moveTabToIncognito',
      },
      {
        id: 'moveTabToNewWindow',
        title: '移動分頁到新視窗',
        description: '移動分頁到新視窗。可用參數：limited=null/true/false',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'moveTabToNewWindow',
      },
      {
        id: 'moveTabToNextWindow',
        title: '移動當前分頁到下一個視窗',
        description: '移動當前分頁到下一個視窗。可用參數：last, position, right=true, tabs',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: ['W'],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'moveTabToNextWindow',
      },
      {
        id: 'newTab',
        title: '打開新的分頁',
        description: '打開新的分頁；原生別名：createTab',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'createTab',
      },
      {
        id: 'nextFrame',
        title: '移動鍵盤焦點到下一個子頁面',
        description: '移動鍵盤焦點到下一個子頁面',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['gf'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'nextFrame',
      },
      {
        id: 'nextTab',
        title: '切換到右側分頁',
        description: '切換到右側分頁。可用參數：blur, wrap=true',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: ['<a-s-c>', 'gt', 'K', '<a-v>'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'nextTab',
      },
      {
        id: 'openBookmark',
        title: '打開書籤的網址',
        description: '打開書籤的網址。可用參數：title, path',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'openBookmark',
      },
      {
        id: 'openCopiedUrlInCurrentTab',
        title: '在當前分頁打開複製的網址',
        description: '在當前分頁打開複製的網址',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['p'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'openCopiedUrlInCurrentTab',
      },
      {
        id: 'openCopiedUrlInNewTab',
        title: '在新分頁打開複製的網址',
        description: '在新分頁打開複製的網址',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['P'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'openCopiedUrlInNewTab',
      },
      {
        id: 'openUrl',
        title: '訪問網址',
        description:
          '訪問網址。可用參數：url:string, urls:string[], reuse=newFg/current/newBg/reuse, incognito, window, position',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'openUrl',
      },
      {
        id: 'parentFrame',
        title: '移動鍵盤焦點到當前子頁面的外層',
        description: '移動鍵盤焦點到當前子頁面的外層',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'parentFrame',
      },
      {
        id: 'passNextKey',
        title: '使下一次按鍵不識別為快速鍵',
        description: '使下一次按鍵不識別為快速鍵。可用參數：expect:string, normal',
        category: 'coexist',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'passNextKey',
      },
      {
        id: 'performAnotherFind',
        title: '使用最近幾次用過的詞語在頁內查詢',
        description: '使用最近幾次用過的詞語在頁內查詢',
        category: 'find',
        kind: 'command',
        mode: 'normal',
        keys: ['<a-n>'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'performAnotherFind',
      },
      {
        id: 'performBackwardsFind',
        title: '在頁內查詢上一處',
        description: '在頁內查詢上一處',
        category: 'find',
        kind: 'command',
        mode: 'normal',
        keys: ['N'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'performBackwardsFind',
      },
      {
        id: 'performFind',
        title: '在頁內查詢下一處',
        description: '在頁內查詢下一處',
        category: 'find',
        kind: 'command',
        mode: 'normal',
        keys: ['n'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'performFind',
      },
      {
        id: 'previousTab',
        title: '切換到左側分頁',
        description: '切換到左側分頁。可用參數：blur, wrap=true',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: ['<a-c>', 'gT', 'J'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'previousTab',
      },
      {
        id: 'quickNext',
        title: '切換到右側分頁',
        description: '切換到右側分頁；原生別名：nextTab。可用參數：blur, wrap=true',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'nextTab',
      },
      {
        id: 'reload',
        title: '刷新當前子頁面',
        description: '刷新當前子頁面。可用參數：hard',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['r'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'reload',
      },
      {
        id: 'reloadGivenTab',
        title: '刷新右側指定位置的分頁',
        description: '刷新右側指定位置的分頁。可用參數：hard',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['R'],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'reloadGivenTab',
      },
      {
        id: 'reloadTab',
        title: '刷新整個網頁',
        description: '刷新整個網頁',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['<a-r>'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'reloadTab',
      },
      {
        id: 'removeRightTab',
        title: '關閉右側指定位置的分頁',
        description: '關閉右側指定位置的分頁',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'removeRightTab',
      },
      {
        id: 'removeTab',
        title: '關閉分頁',
        description:
          '關閉分頁。可用參數：keepWindow=""/always, mayClose, goto=""/left/right/previous',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: ['x'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'removeTab',
      },
      {
        id: 'reopenTab',
        title: '重新打開當前頁面（不可前進後退）',
        description: '重新打開當前頁面（不可前進後退）',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['<a-s-r>'],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'reopenTab',
      },
      {
        id: 'reset',
        title: '重置介面狀態並回到命令模式',
        description: '重置介面狀態並回到命令模式',
        category: 'coexist',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'reset',
      },
      {
        id: 'restoreGivenTab',
        title: '恢復指定序號的最近關閉的分頁',
        description: '恢復指定序號的最近關閉的分頁',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'restoreGivenTab',
      },
      {
        id: 'restoreTab',
        title: '恢復最近關閉的網頁',
        description: '恢復最近關閉的網頁',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: ['X'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'restoreTab',
      },
      {
        id: 'runKey',
        title: '選擇並執行另一個快速鍵',
        description: '選擇並執行另一個快速鍵。可用參數：expect:Envs, keys:KeySequence[]|string',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'runKey',
      },
      {
        id: 'scrollDown',
        title: '向下滾動',
        description: '向下滾動。可用參數：keepHover=true|false|auto|never',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['<c-e>', 'j'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollDown',
      },
      {
        id: 'scrollFullPageDown',
        title: '向下滾動整個頁面的高度',
        description: '向下滾動整個頁面的高度',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollFullPageDown',
      },
      {
        id: 'scrollFullPageUp',
        title: '向上滾動整個頁面的高度',
        description: '向上滾動整個頁面的高度',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollFullPageUp',
      },
      {
        id: 'scrollLeft',
        title: '向左滾動',
        description: '向左滾動',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['h'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollLeft',
      },
      {
        id: 'scrollPageDown',
        title: '向下滾動半個頁面的高度',
        description: '向下滾動半個頁面的高度',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['d'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollPageDown',
      },
      {
        id: 'scrollPageUp',
        title: '向上滾動半個頁面的高度',
        description: '向上滾動半個頁面的高度',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['u'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollPageUp',
      },
      {
        id: 'scrollPxDown',
        title: '向下滾動 1 像素',
        description: '向下滾動 1 像素',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollPxDown',
      },
      {
        id: 'scrollPxLeft',
        title: '向左滾動 1 像素',
        description: '向左滾動 1 像素',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollPxLeft',
      },
      {
        id: 'scrollPxRight',
        title: '向右滾動 1 像素',
        description: '向右滾動 1 像素',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollPxRight',
      },
      {
        id: 'scrollPxUp',
        title: '向上滾動 1 像素',
        description: '向上滾動 1 像素',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollPxUp',
      },
      {
        id: 'scrollRight',
        title: '向右滾動',
        description: '向右滾動',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['l'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollRight',
      },
      {
        id: 'scrollSelect',
        title: '在（關閉狀態的）下拉列表的選項中切換',
        description:
          '在（關閉狀態的）下拉列表的選項中切換。可用參數：dir=down|up, position=""|begin|end',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollSelect',
      },
      {
        id: 'scrollTo',
        title: '滾動到指定位置',
        description: '滾動到指定位置',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollTo',
      },
      {
        id: 'scrollToBottom',
        title: '滾動到底部',
        description: '滾動到底部',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['G'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollToBottom',
      },
      {
        id: 'scrollToLeft',
        title: '滾動到最左側',
        description: '滾動到最左側',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['zH'],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollToLeft',
      },
      {
        id: 'scrollToRight',
        title: '滾動到最右側',
        description: '滾動到最右側',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['zL'],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollToRight',
      },
      {
        id: 'scrollToTop',
        title: '滾動到頂部',
        description: '滾動到頂部',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['gg'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollToTop',
      },
      {
        id: 'scrollUp',
        title: '向上滾動',
        description: '向上滾動。可用參數：keepHover=true|false|auto|never',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['k', '<c-y>'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'scrollUp',
      },
      {
        id: 'searchAs',
        title: '在當前搜尋引擎中智能搜尋選中或已複製的文字',
        description:
          '在當前搜尋引擎中智能搜尋選中或已複製的文字。可用參數：copied=true, selected=true',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'searchAs',
      },
      {
        id: 'searchInAnother',
        title: '智能切換到其他搜尋引擎',
        description: '智能切換到其他搜尋引擎。可用參數：keyword, reuse=current/newFg/newBg/reuse',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'searchInAnother',
      },
      {
        id: 'sendToExtension',
        title: '向另一個擴充發送訊息',
        description: '向另一個擴充發送訊息。可用參數：id:string, data:any, raw',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'sendToExtension',
      },
      {
        id: 'showHelp',
        title: '顯示幫助頁面',
        description: '顯示幫助頁面',
        category: 'coexist',
        kind: 'command',
        mode: 'normal',
        keys: ['?'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'showHelp',
      },
      {
        id: 'showHud',
        title: '顯示任意提示文字',
        description: '顯示任意提示文字；原生別名：showTip。可用參數：text:string',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'showTip',
      },
      {
        id: 'showHUD',
        title: '顯示任意提示文字',
        description: '顯示任意提示文字；原生別名：showTip。可用參數：text:string',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'showTip',
      },
      {
        id: 'showTip',
        title: '顯示任意提示文字',
        description: '顯示任意提示文字。可用參數：text:string',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'showTip',
      },
      {
        id: 'simBackspace',
        title: '模擬退格鍵刪除文字',
        description: '模擬退格鍵刪除文字；原生別名：simulateBackspace',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['<f1>'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'simulateBackspace',
      },
      {
        id: 'simulateBackspace',
        title: '模擬退格鍵刪除文字',
        description: '模擬退格鍵刪除文字',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'simulateBackspace',
      },
      {
        id: 'sortTabs',
        title: '對當前視窗的所有分頁重新排序',
        description: '對當前視窗的所有分頁重新排序。可用參數：sort=recency|createTime',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'sortTabs',
      },
      {
        id: 'switchFocus',
        title: '從當前輸入框移走鍵盤焦點或恢復',
        description:
          '從當前輸入框移走鍵盤焦點或恢復。可用參數：flash, select=""/all/all-line/start/end',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['<s-f1>', '<f2>'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'switchFocus',
      },
      {
        id: 'toggleContentSetting',
        title: '切換網站對一項功能的使用權限',
        description: '切換網站對一項功能的使用權限。可用參數：type=images',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'toggleContentSetting',
      },
      {
        id: 'toggleCS',
        title: '切換網站對一項功能的使用權限',
        description:
          '切換網站對一項功能的使用權限；原生別名：toggleContentSetting。可用參數：type=images',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'toggleContentSetting',
      },
      {
        id: 'toggleLinkHintCharacters',
        title: '在當前頁面臨時切換用於定位連結和按鈕的序號字母',
        description: '在當前頁面臨時切換用於定位連結和按鈕的序號字母。可用參數：value:string',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'toggleLinkHintCharacters',
      },
      {
        id: 'toggleMuteTab',
        title: '切換網頁靜音',
        description: '切換網頁靜音。可用參數：all, other',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: ['<a-m>'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'toggleMuteTab',
      },
      {
        id: 'togglePinTab',
        title: '固定/取消固定分頁',
        description: '固定/取消固定分頁',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: ['<a-p>'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'togglePinTab',
      },
      {
        id: 'toggleReaderMode',
        title: '切換閱讀模式',
        description: '切換閱讀模式',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'toggleReaderMode',
      },
      {
        id: 'toggleStyle',
        title: '添加或停用指定 CSS 樣式',
        description: '添加或停用指定 CSS 樣式。可用參數：id/selector:string, css: string',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'toggleStyle',
      },
      {
        id: 'toggleSwitchTemp',
        title: '在當前頁面臨時切換任意選項',
        description: '在當前頁面臨時切換任意選項。可用參數：key:string, [value:any]',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'toggleSwitchTemp',
      },
      {
        id: 'toggleUrl',
        title: '修改當前分頁網址並訪問',
        description: '修改當前分頁網址並訪問',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'toggleUrl',
      },
      {
        id: 'toggleViewSource',
        title: '顯示當前頁面的原始碼',
        description: '顯示當前頁面的原始碼',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: ['gs'],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'toggleViewSource',
      },
      {
        id: 'toggleVomnibarStyle',
        title: '臨時切換搜尋框的樣式風格',
        description: '臨時切換搜尋框的樣式風格。可用參數：style=dark, current',
        category: 'vomnibar',
        kind: 'command',
        mode: 'normal',
        keys: ['gn'],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'toggleVomnibarStyle',
      },
      {
        id: 'toggleWindow',
        title: '改變視窗狀態',
        description: '改變視窗狀態。可用參數：states="normal,maximized"',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'toggleWindow',
      },
      {
        id: 'visitPreviousTab',
        title: '切換到最近訪問的上一個分頁',
        description: '切換到最近訪問的上一個分頁。可用參數：blur, acrossWindows, onlyActive',
        category: 'tabs',
        kind: 'command',
        mode: 'normal',
        keys: ['^'],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'visitPreviousTab',
      },
      {
        id: 'wait',
        title: '空操作',
        description: '空操作；原生別名：blank',
        category: 'advanced',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'blank',
      },
      {
        id: 'zoom',
        title: '縮放網頁',
        description: '縮放網頁。可用參數：in, out, reset',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: false,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'zoom',
      },
      {
        id: 'zoomIn',
        title: '放大網頁',
        description: '放大網頁',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'zoomIn',
      },
      {
        id: 'zoomOut',
        title: '縮小網頁',
        description: '縮小網頁',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'zoomOut',
      },
      {
        id: 'zoomReset',
        title: '重置網頁縮放比例',
        description: '重置網頁縮放比例',
        category: 'navigation',
        kind: 'command',
        mode: 'normal',
        keys: [],
        advanced: true,
        url: 'https://github.com/gdh1995/vimium-c/blob/9e780336ee36ef947e76258e2018cceb69de7e4f/background/key_mappings.ts',
        canonical: 'zoomReset',
      },
    ];
    const visualDefinitions = [
      ['left', '前一個字元', ['h']],
      ['right', '後一個字元', ['l']],
      ['down', '下一個畫面行', ['j']],
      ['up', '上一個畫面行', ['k']],
      ['wordNext', '下一詞起點', ['w', 'W']],
      ['wordEnd', '詞尾', ['e']],
      ['wordPrevious', '前一詞起點', ['b', 'B']],
      ['lineStart', '畫面行首', ['0']],
      ['lineEnd', '畫面行尾', ['$']],
      ['documentStart', '文件起點', ['gg']],
      ['documentEnd', '文件終點', ['G']],
      ['sentencePrevious', '前一句', ['(']],
      ['sentenceNext', '後一句', [')']],
      ['paragraphPrevious', '前一段', ['{']],
      ['paragraphNext', '後一段', ['}']],
      ['reverse', '交換選取端點', ['o']],
      ['aroundWord', '選取詞語', ['aw']],
      ['aroundSentence', '選取句子', ['as']],
      ['aroundParagraph', '選取段落', ['ap', 'a}']],
      ['yank', '複製選取並退出', ['y']],
      ['yankLine', '複製完整畫面行', ['Y']],
      ['copyStay', '複製並保留模式', ['C']],
      ['copyRich', '複製富文字', ['<c-s-c>', '<m-s-c>']],
      ['openNew', '以選取文字開啟新分頁', ['p']],
      ['openCurrent', '以選取文字在目前分頁開啟', ['P']],
      ['extendFind', '向後搜尋並延伸選取', ['f']],
      ['extendFindPrevious', '向前搜尋並延伸選取', ['F']],
      ['findNext', '下一個搜尋命中', ['n']],
      ['findPrevious', '上一個搜尋命中', ['N']],
      ['highlight', '顯示目前選取位置', ['<f1>', '<a-f1>']],
      ['visual', 'Visual 字元選取', ['v']],
      ['line', 'Visual Line 行選取', ['V']],
      ['caret', 'Caret 游標', ['c']],
      ['find', '在選取模式搜尋', ['/']],
      ['findBackwards', '在選取模式向前搜尋', ['?']],
      ['scrollDown', '捲動畫面但保留選取', ['<c-e>', '<c-down>']],
      ['scrollUp', '向上捲動畫面但保留選取', ['<c-y>', '<c-up>']],
      ['escape', '退出文字模式', ['<esc>']],
    ];
    const contextualRows = visualDefinitions.map(([name, title, keys]) => ({
      id: 'visual:' + name,
      title,
      description:
        title + '；Visual／Caret／Visual Line 的原生模式內操作。詞界與畫面行界由瀏覽器決定。',
      category: 'visual',
      kind: 'motion',
      mode: 'visual',
      keys,
      advanced: ![
        'left',
        'right',
        'down',
        'up',
        'wordNext',
        'wordEnd',
        'wordPrevious',
        'yank',
        'visual',
        'line',
        'caret',
        'escape',
      ].includes(name),
      url: source.url.replace('/tree/', '/blob/') + '/background/key_mappings.ts',
    }));
    const omniDefinitions = [
      ['next', '下一個候選', ['<down>', '<tab>', '<c-j>', '<c-n>']],
      ['previous', '上一個候選', ['<up>', '<s-tab>', '<c-k>', '<c-p>']],
      ['pagePrevious', '上一頁候選', ['<pageup>']],
      ['pageNext', '下一頁候選', ['<pagedown>']],
      ['confirm', '確認目前候選', ['<enter>']],
      ['close', '關閉 Vomnibar', ['<esc>']],
    ];
    contextualRows.push(
      ...omniDefinitions.map(([name, title, keys]) => ({
        id: 'vomnibar:' + name,
        title,
        description: title + '；僅在 Vomnibar 內。開啟位置取決於啟動 Vomnibar 的命令與選項。',
        category: 'vomnibar',
        kind: 'motion',
        mode: 'vomnibar',
        keys,
        advanced: false,
        url: source.url.replace('/tree/', '/blob/') + '/front/vomnibar.ts',
      }))
    );
    contextualRows.push(
      ...['userCustomized1', 'userCustomized2'].map((name) => ({
        id: 'browser:' + name,
        title: '瀏覽器快捷鍵：' + name,
        description: '實際按鍵由瀏覽器的擴充套件快捷鍵設定指定，不包含在 Vimium C 的匯出檔中。',
        category: 'coexist',
        kind: 'browser',
        mode: 'browser',
        keys: [],
        advanced: true,
        url: source.url.replace('/tree/', '/blob/') + '/manifest.json',
      }))
    );
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const baseCatalog = [...nativeRows, ...contextualRows];
    const knownCommands = new Set(nativeRows.map((row) => row.id));
    const modeIds = {
      i: 'insert',
      l: 'hints',
      f: 'find',
      v: 'visual',
      m: 'marks',
      o: 'vomnibar',
      n: 'normal-start',
      e: 'normal-prefix',
      s: 'show',
    };
    contextualRows.find((row) => row.id === 'visual:copyRich').description +=
      ' Meta+Shift+C 僅適用 macOS。';

    // 保留原始實體行；換行接續只用於解析，不覆寫使用者的原文。
    function logicalLines(text) {
      const physical = text
        .replace(/\r\n?/g, '\n')
        .replace(/\u00a0/g, ' ')
        .split('\n');
      const lines = [];
      for (let i = 0; i < physical.length; i++) {
        const start = i + 1,
          raw = [physical[i]];
        let value = physical[i],
          incomplete = false;
        while (value.endsWith('\\')) {
          if (i + 1 >= physical.length) {
            incomplete = true;
            break;
          }
          const doubled = value.endsWith('\\\\');
          value = value.slice(0, doubled ? -2 : -1);
          raw.push(physical[++i]);
          value += doubled ? physical[i].trimStart() : physical[i];
        }
        lines.push({
          line: start,
          endLine: i + 1,
          raw: raw.join('\n'),
          text: value.trim(),
          incomplete,
        });
      }
      return lines;
    }
    function uncomment(text) {
      let quote = '',
        escaped = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (c === '\\') {
          escaped = true;
          continue;
        }
        if (quote) {
          if (c === quote) quote = '';
          continue;
        }
        if (c === '"' || c === "'") {
          quote = c;
          continue;
        }
        if ((i === 0 || /\s/.test(text[i - 1])) && (c === '#' || text.startsWith('//', i)))
          return text.slice(0, i).trimEnd();
      }
      return text;
    }
    function keyTokens(value) {
      const tokens = [];
      for (let i = 0; i < value.length;) {
        if (value[i] === '<' && value[i + 1] !== '<') {
          const end = value.indexOf('>', i + 1);
          if (end > i + 1) {
            const body = value.slice(i + 1, end);
            if (/\s/.test(body)) return null;
            tokens.push(body.length === 1 ? body : '<' + (body === 'escape' ? 'esc' : body) + '>');
            i = end + 1;
            continue;
          }
        }
        const token = String.fromCodePoint(value.codePointAt(i));
        if (/\s/.test(token)) return null;
        tokens.push(token);
        i += token.length;
      }
      return tokens.length ? tokens : null;
    }
    function mappingKey(raw, allowMode = false) {
      let key = raw,
        mode = 'normal';
      const suffix = /^<([^<>]+):([a-z])>$/.exec(raw);
      if (suffix) {
        if (!allowMode && suffix[2] !== 'i') return null;
        if (allowMode && !modeIds[suffix[2]]) return null;
        key = suffix[1].length === 1 ? suffix[1] : '<' + suffix[1] + '>';
        mode = allowMode ? modeIds[suffix[2]] : 'insert';
      } else if (/:[a-z]>/.test(raw)) return null;
      const tokens = keyTokens(key);
      return tokens ? { key: tokens.join(''), mode, tokens } : null;
    }
    function displayedKey(key, mode) {
      if (mode !== 'insert') return key;
      return key.startsWith('<') && key.endsWith('>')
        ? key.slice(0, -1) + ':i>'
        : '<' + key + ':i>';
    }
    function decodeBase64(line) {
      const encoded = line.slice(8).trim();
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1)
        throw new Error('base64');
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let bits = 0,
        value = 0,
        escaped = '';
      for (const char of encoded.replace(/=+$/, '')) {
        value = (value << 6) | alphabet.indexOf(char);
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          escaped += '%' + ((value >> bits) & 255).toString(16).padStart(2, '0');
        }
      }
      return decodeURIComponent(escaped);
    }
    function decodeMappings(value, diagnostics) {
      if (value == null) return '';
      if (
        typeof value !== 'string' &&
        !(Array.isArray(value) && value.every((line) => typeof line === 'string'))
      )
        throw new Error('keyMappings 必須是文字或文字陣列。');
      return (Array.isArray(value) ? value.join('\n') : value)
        .replace(/\r\n?/g, '\n')
        .replace(/\u00a0/g, ' ')
        .split('\n')
        .map((line, index) => {
          if (!line.startsWith('$base64:')) return line;
          try {
            return decodeBase64(line);
          } catch {
            diagnostics.push({ line: index + 1, message: '無法解碼此 $base64 行；已保留原文。' });
            return line;
          }
        })
        .join('\n')
        .trimEnd();
    }

    function parseImport(text) {
      if (typeof text !== 'string') throw new Error('請提供設定檔或鍵位文字。');
      if (text.length > 1_000_000) throw new Error('匯入內容不可超過 1,000,000 個字元。');
      const raw = text.replace(/^\uFEFF/, ''),
        trimmed = raw.trim(),
        diagnostics = [];
      let data = null,
        format = 'mappings';
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          data = JSON.parse(trimmed);
        } catch {
          throw new Error('JSON 格式無效；請使用 Vimium C Options 匯出的設定檔。');
        }
        if (
          !data ||
          typeof data !== 'object' ||
          Array.isArray(data) ||
          !['Vimium C', 'Vimium++'].includes(data.name)
        )
          throw new Error('這不是 Vimium C 原生匯出 JSON。');
        format = 'native-json';
        if (Object.hasOwn(data, 'keyMappings') && data.keyMappings === null)
          throw new Error('keyMappings 必須是文字或文字陣列，不能是 null。');
        if (
          data.environment != null &&
          (!data.environment ||
            typeof data.environment !== 'object' ||
            Array.isArray(data.environment))
        )
          throw new Error('environment 必須是物件。');
        if (
          data.exclusionRules != null &&
          (!Array.isArray(data.exclusionRules) ||
            data.exclusionRules.some(
              (rule) =>
                !rule || typeof rule.pattern !== 'string' || typeof rule.passKeys !== 'string'
            ))
        )
          throw new Error('exclusionRules 必須包含 pattern／passKeys 文字。');
      }
      const environment = data?.environment ? clone(data.environment) : {};
      const version = environment.extension == null ? '' : String(environment.extension);
      const versionMatch = !version
        ? 'unspecified'
        : /^2\.12\.[234](?:\D.*)?$/.test(version)
          ? 'family'
          : 'different';
      const mappings = decodeMappings(data ? data.keyMappings : raw, diagnostics);
      const profile = {
        label: data ? data.name + ' 匯入設定' + (version ? ' ' + version : '') : '自訂鍵位文字',
        version,
        raw,
        format,
        mappings,
        environment,
        exclusionRules: data?.exclusionRules == null ? null : clone(data.exclusionRules),
        exclusionOnlyFirstMatch: data?.exclusionOnlyFirstMatch ?? null,
        exclusionListenHash: data?.exclusionListenHash ?? null,
        keyLayout: data?.keyLayout ?? null,
        versionMatch,
        completeness: 'complete',
        diagnostics,
        directives: [],
        omitted: {
          keyMappings: !!data && !Object.hasOwn(data, 'keyMappings'),
          exclusionRules: !!data && !Object.hasOwn(data, 'exclusionRules'),
        },
        globalUncertainty: versionMatch === 'different',
        summary: { parsed: 0, unresolved: 0, translations: 0 },
      };
      const diagnose = (line, message) => diagnostics.push({ line, message });
      if (versionMatch === 'different')
        diagnose(0, '匯出版本與 2.12.2 參考資料不同；不推定最終鍵位。');
      if (data?.name === 'Vimium++') diagnose(0, '這是舊版格式；已保留原文，請以原生 Help 核對。');
      const overrides = data
        ? ['chrome', 'chromium', 'firefox', 'edge', 'safari'].filter(
            (name) => data[name] && typeof data[name] === 'object'
          )
        : [];
      if (overrides.length) {
        profile.globalUncertainty = true;
        diagnose(0, '含瀏覽器專用覆寫（' + overrides.join('、') + '）；未選定其執行環境。');
      }
      let depth = 0,
        header = true,
        noCheck = false;
      const declared = new Set(),
        remapped = new Map(),
        blocks = [];
      const prefixChanges = new Set();
      if (
        data &&
        ((Object.hasOwn(data, 'keyLayout') && data.keyLayout !== 260) ||
          ['ignoreKeyboardLayout', 'ignoreCapsLock', 'mapModifier'].some((key) =>
            Object.hasOwn(data, key)
          ))
      ) {
        profile.globalUncertainty = true;
        diagnose(0, '含自訂鍵盤布局／修飾鍵設定；不推定轉譯後的實體鍵位。');
      }
      for (const logical of logicalLines(mappings)) {
        const d = {
          line: logical.line,
          endLine: logical.endLine,
          raw: logical.raw,
          kind: 'unknown',
          status: 'parsed',
          key: '',
          mode: 'normal',
          command: '',
          options: '',
          conditional: depth > 0,
          noCheck,
        };
        const initial = logical.text;
        if (!initial) continue;
        if (/^#if(?:\s|$)/.test(initial)) {
          depth++;
          blocks.push(logical.line);
          header = false;
          noCheck = false;
          d.kind = 'condition';
          d.status = 'conditional';
          d.conditional = true;
          profile.directives.push(d);
          diagnose(d.line, '條件區塊僅保留原文；不選擇任何分支。');
          continue;
        }
        if (/^#(?:else|endif)(?:\s|$)/.test(initial)) {
          d.kind = 'condition';
          d.status = 'conditional';
          d.conditional = true;
          if (!depth) {
            profile.globalUncertainty = true;
            diagnose(d.line, '條件邊界缺少對應的 #if。');
          } else if (initial.startsWith('#endif')) {
            depth--;
            blocks.pop();
          }
          profile.directives.push(d);
          continue;
        }
        if (initial.startsWith('#') || initial.startsWith('//')) {
          if (header && /^#!\s*no-check\s*$/.test(initial)) noCheck = true;
          continue;
        }
        header = false;
        d.noCheck = noCheck;
        const line = uncomment(initial),
          parts = /^(\S+)(?:\s+(\S+))?(?:\s+(\S+))?(?:\s+([\s\S]*))?$/.exec(line);
        if (!parts) continue;
        const verb = parts[1],
          rawKey = parts[2] || '',
          value = parts[3] || '',
          tail = parts[4] || '';
        d.options = tail;
        d.conditional = depth > 0 || /(?:^|\s)\$if=/.test(line);
        if (logical.incomplete) {
          d.status = 'unresolved';
          diagnose(d.line, '換行接續尚未完成。');
        }
        if (verb === 'unmapAll' || verb === 'unmapall') {
          d.kind = 'reset';
          if (rawKey) {
            d.status = 'unresolved';
            diagnose(d.line, 'unmapAll 的額外內容未解析。');
          }
          if (d.conditional || d.status !== 'parsed') profile.globalUncertainty = true;
          else {
            declared.clear();
            remapped.clear();
            prefixChanges.clear();
          }
        } else if (['map', 'map!', 'run', 'run!', 'unmap', 'unmap!'].includes(verb)) {
          const info = mappingKey(rawKey),
            bang = verb.endsWith('!');
          d.kind = verb.startsWith('unmap') ? 'unmap' : verb.startsWith('run') ? 'workflow' : 'map';
          d.command = d.kind === 'workflow' ? 'runKey' : value;
          d.options =
            d.kind === 'unmap'
              ? [value, tail].filter(Boolean).join(' ')
              : d.kind === 'workflow'
                ? 'keys=' + JSON.stringify(value) + (tail ? ' ' + tail : '')
                : tail;
          if (
            !info ||
            (d.kind !== 'unmap' && !value) ||
            (bang &&
              d.kind !== 'unmap' &&
              (info.mode !== 'normal' || info.tokens.length !== 1 || !rawKey.startsWith('<')))
          ) {
            d.status = 'unresolved';
            d.key = rawKey;
            diagnose(d.line, '鍵位或命令格式未能確認；已保留原文。');
          } else {
            d.key = info.key;
            d.mode = info.mode;
            d.modes =
              bang && rawKey.startsWith('<') && info.mode === 'normal'
                ? ['normal', 'insert']
                : [info.mode];
            if (verb === 'run!') {
              d.status = 'unresolved';
              diagnose(d.line, 'run! 的原生處理不在保守解析範圍內；僅保留原文。');
            } else if (d.kind === 'unmap' && value && !value.startsWith('$')) {
              d.status = 'unresolved';
              diagnose(d.line, 'unmap 的額外內容未解析；僅保留原文。');
            } else if (info.key.includes('<__proto__>')) {
              d.status = 'unresolved';
              diagnose(d.line, '此鍵序列被原生解析器保留，僅保留原文。');
            } else if (d.kind === 'unmap' && /^(?:[0-9-]|<esc>|<c-\[>)$/.test(info.key)) {
              d.status = 'unresolved';
              prefixChanges.add(info.key);
              diagnose(d.line, '此 unmap 會改變原生數字前綴或 Escape 行為；僅保留原文。');
            } else if (d.kind !== 'unmap' && info.mode === 'normal' && /^[0-9-]/.test(info.key)) {
              d.status = 'unresolved';
              diagnose(
                d.line,
                prefixChanges.has(info.key[0])
                  ? '此映射依賴數字前綴的重新定義；僅保留原文。'
                  : '數字／減號前綴的映射不在保守解析範圍內；僅保留原文。'
              );
            } else if (d.kind === 'map' && !knownCommands.has(value)) {
              d.status = 'unresolved';
              diagnose(d.line, '參考版本沒有此命令：' + value);
            } else if (d.kind === 'workflow' || value === 'runKey') {
              d.kind = 'workflow';
              d.status = 'workflow';
              diagnose(d.line, '自訂 runKey 流程不展開；顯示原始流程與選項。');
            }
            if (!d.conditional && ['parsed', 'workflow'].includes(d.status)) {
              const slots = d.modes.map((mode) => mode + '\0' + d.key);
              if (d.kind === 'unmap') slots.forEach((slot) => declared.delete(slot));
              else if (!noCheck && declared.has(d.mode + '\0' + d.key)) {
                d.status = 'rejected';
                diagnose(d.line, '重複的自訂 map：原生檢查模式保留先前定義，此行不套用。');
              } else slots.forEach((slot) => declared.add(slot));
            }
          }
        } else if (verb === 'mapKey' || verb === 'mapkey') {
          d.kind = 'remap';
          const from = mappingKey(rawKey, true),
            to = mappingKey(value);
          if (
            !from ||
            !to ||
            from.tokens.length !== 1 ||
            to.tokens.length !== 1 ||
            to.mode !== 'normal'
          ) {
            d.status = 'unresolved';
            diagnose(d.line, 'mapKey 必須是單一來源／目標鍵及可辨識的模式。');
          } else {
            d.key = from.key;
            d.mode = /:\w>$/.test(rawKey) ? from.mode : 'all';
            d.target = to.key;
            const slot = d.mode + '\0' + d.key;
            if (tail && !d.conditional) {
              d.status = 'unresolved';
              diagnose(d.line, 'mapKey 的額外選項未解析；僅保留原文。');
            } else if (
              !d.conditional &&
              !noCheck &&
              remapped.has(slot) &&
              remapped.get(slot) !== d.target
            ) {
              d.status = 'rejected';
              diagnose(d.line, '重複 mapKey 指向不同目標；不套用後一行。');
            } else if (!d.conditional) remapped.set(slot, d.target);
            if (d.status === 'parsed')
              diagnose(d.line, 'mapKey 保留為獨立按鍵轉譯；不推導轉譯後的實體按鍵。');
          }
        } else if (verb === 'env') {
          d.kind = 'environment';
          d.key = rawKey;
          d.options = [value, tail].filter(Boolean).join(' ');
          d.status = 'unresolved';
          diagnose(d.line, 'env 是動態條件宣告；僅保留原文。');
        } else if (verb === 'shortcut' || verb === 'command') {
          d.kind = 'browser';
          d.key = rawKey;
          d.mode = 'browser';
          d.options = [value, tail].filter(Boolean).join(' ');
          d.status = 'browser';
          diagnose(d.line, '瀏覽器 shortcut 的實體按鍵不在此設定文字中。');
        } else {
          d.status = 'unresolved';
          d.key = rawKey;
          diagnose(d.line, '未支援的指令行：' + verb + '；未套用。');
          if (initial.startsWith('$base64:')) profile.globalUncertainty = true;
        }
        if (d.conditional) {
          d.status = 'conditional';
          if (depth === 0) diagnose(d.line, '含 $if 條件；僅保留原文，不推定是否生效。');
        }
        profile.directives.push(d);
      }
      if (depth) {
        profile.globalUncertainty = true;
        diagnose(blocks[0] || 0, '#if 區塊沒有完整 #endif；後續原文未套用。');
      }
      profile.summary = {
        parsed: profile.directives.filter((d) => d.status === 'parsed').length,
        unresolved: profile.directives.filter((d) => d.status !== 'parsed').length,
        translations: profile.directives.filter((d) => d.kind === 'remap').length,
      };
      if (diagnostics.length || profile.globalUncertainty) profile.completeness = 'partial';
      return profile;
    }

    function resolve(profile = null) {
      const rows = baseCatalog.map((row) => ({
        ...clone(row),
        keys: [],
        bindings: [],
        status: profile ? 'unbound' : 'default',
      }));
      const byId = new Map(rows.map((row) => [row.id, row])),
        slots = new Map(),
        tainted = new Set(),
        translations = new Map();
      let globallyUncertain = Boolean(profile?.globalUncertainty);
      const put = (id, key, mode, options, status, line, origin = 'import') =>
        slots.set(mode + '\0' + key, { id, key, mode, options, status, line, origin });
      for (const row of baseCatalog)
        for (const key of row.keys) put(row.id, key, row.mode, '', 'default', 0, 'default');
      const makeCustom = (d, suffix = '') => {
        const id = 'import:' + d.line + suffix;
        if (byId.has(id)) return id;
        const row = {
          id,
          title:
            d.kind === 'workflow'
              ? '自訂流程：' + d.key
              : d.kind === 'remap'
                ? '按鍵轉譯：' + d.key + ' → ' + (d.target || '?')
                : d.kind === 'browser'
                  ? '瀏覽器 shortcut：' + d.key
                  : '保留原文：第 ' + d.line + ' 行',
          description: d.raw,
          category: d.kind === 'browser' ? 'coexist' : 'advanced',
          kind: d.kind === 'browser' ? 'browser' : 'command',
          mode:
            d.mode === 'visual'
              ? 'visual'
              : d.mode === 'vomnibar'
                ? 'vomnibar'
                : d.mode === 'browser'
                  ? 'browser'
                  : 'normal',
          keys: [],
          advanced: true,
          url: source.url.replace('/tree/', '/blob/') + '/background/key_mappings.ts',
          bindings: [],
          status: d.status,
          raw: d.raw,
        };
        rows.push(row);
        byId.set(id, row);
        return id;
      };
      for (const d of profile?.directives || []) {
        if (d.kind === 'condition') continue;
        const modes = d.modes || [d.mode || 'normal'];
        if (d.kind === 'reset' && d.status === 'parsed' && !d.conditional) {
          for (const [slot, b] of slots)
            if (b.mode === 'normal' || b.mode === 'insert') slots.delete(slot);
          tainted.clear();
          translations.clear();
          // 不同版本／瀏覽器覆寫仍未知，普通條件區塊的不確定性可被明確 reset 消除。
          globallyUncertain =
            profile.versionMatch === 'different' ||
            profile.diagnostics.some((x) => x.line === 0 && /覆寫|布局/.test(x.message));
          continue;
        }
        if (d.status === 'rejected') {
          const row = byId.get(makeCustom(d));
          row.bindings.push({
            key: d.key,
            mode: d.mode,
            options: d.options,
            status: d.status,
            line: d.line,
          });
          continue;
        }
        if (d.conditional || d.status === 'unresolved') {
          const row = byId.get(makeCustom(d));
          row.bindings.push({
            key: d.key,
            mode: d.mode,
            options: d.options,
            status: d.status,
            line: d.line,
          });
          if (d.kind === 'reset') globallyUncertain = true;
          else if (d.kind === 'map' || d.kind === 'workflow' || d.kind === 'unmap')
            modes.forEach((mode) => tainted.add(mode + '\0' + d.key));
          else if (d.kind === 'remap') translations.set(d.mode + '\0' + d.key, d);
          continue;
        }
        if (d.kind === 'remap') {
          translations.set(d.mode + '\0' + d.key, d);
          const row = byId.get(makeCustom(d));
          row.status = 'translation';
          row.bindings.push({
            key: d.key,
            mode: d.mode,
            options: '→ ' + d.target,
            status: 'translation',
            line: d.line,
          });
        } else if (d.kind === 'unmap') {
          modes.forEach((mode) => {
            slots.delete(mode + '\0' + d.key);
            tainted.delete(mode + '\0' + d.key);
          });
        } else if (d.kind === 'map' || d.kind === 'workflow') {
          const id = d.kind === 'workflow' ? makeCustom(d) : d.command;
          if (byId.has(id))
            modes.forEach((mode) =>
              put(
                id,
                d.key,
                mode,
                d.options,
                d.kind === 'workflow' ? 'workflow' : 'resolved',
                d.line
              )
            );
        } else {
          const row = byId.get(makeCustom(d));
          row.bindings.push({
            key: d.key,
            mode: d.mode,
            options: d.options,
            status: d.status,
            line: d.line,
          });
        }
      }
      const values = [...slots.values()];
      const translationApplies = (translation, binding) =>
        translation.mode === 'all' ||
        translation.mode === binding.mode ||
        (binding.mode === 'normal' && ['normal-start', 'normal-prefix'].includes(translation.mode));
      const matchesTranslation = (key, sourceKey) => {
        const tokens = keyTokens(key) || [];
        return tokens.some(
          (token) =>
            token === sourceKey ||
            (sourceKey.length === 1 &&
              sourceKey === sourceKey.toLowerCase() &&
              (token === sourceKey.toUpperCase() ||
                (token.startsWith('<') && token.slice(1, -1).split('-').at(-1) === sourceKey)))
        );
      };
      for (const b of values) {
        let status = b.status;
        const keyParts = keyTokens(b.key) || [];
        if (globallyUncertain || tainted.has(b.mode + '\0' + b.key)) status = 'uncertain';
        else if (
          [...translations.values()].some(
            (t) => translationApplies(t, b) && matchesTranslation(b.key, t.key)
          )
        )
          status = 'translated';
        else if (
          values.some(
            (other) =>
              other !== b &&
              other.mode === b.mode &&
              (() => {
                const p = keyTokens(other.key) || [];
                return p.length < keyParts.length && p.every((token, i) => token === keyParts[i]);
              })()
          )
        )
          status = 'shadowed';
        const row = byId.get(b.id);
        if (!row) continue;
        row.bindings.push({ key: b.key, mode: b.mode, options: b.options, status, line: b.line });
        if (['default', 'resolved', 'workflow'].includes(status))
          row.keys.push(displayedKey(b.key, b.mode));
      }
      for (const row of rows) {
        row.keys = [...new Set(row.keys)];
        if (row.bindings.some((b) => ['uncertain', 'translated', 'shadowed'].includes(b.status)))
          row.status = row.keys.length ? 'mixed' : 'uncertain';
        else if (row.bindings.some((b) => b.status === 'workflow')) row.status = 'workflow';
        else if (row.keys.length) row.status = profile ? 'resolved' : 'default';
        if (row.bindings.some((b) => b.options))
          row.description += '。含自訂參數／原文時，實際語意請以該設定為準。';
      }
      return rows;
    }
    return {
      source: clone(source),
      categories: clone(categories),
      catalog: clone(baseCatalog),
      parseImport,
      resolve,
    };
  }

  /* REFERENCE MODEL END */

  function createCompanionUI(api) {
    const doc = document;
    const reference = api.reference;
    const source = reference.source;
    const statusSnippet = String.raw`map <f7> openUrl url="vimium://status/toggle/^\u0020<f7>"`;
    const statusURL =
      'https://github.com/gdh1995/vimium-c/wiki/Enable-or-Disable-all-frames-by-a-shortcut';
    const categories = [...reference.categories, { id: 'favorites', title: '我的收藏' }];
    let view = 'catalog';
    let modalOpen = false;
    let query = '';
    let catalogCategory = 'all';
    let showAdvanced = true;
    let preview = null;
    let previewText = '';
    let importGeneration = 0;
    let composing = false;
    let compositionTimer;
    let statusTimer;
    let drag = null;
    let dragPosition = null;
    const refs = {};

    function el(tag, attrs = {}, children = []) {
      const node = doc.createElement(tag);
      for (const [name, value] of Object.entries(attrs)) {
        if (name === 'class') node.className = value;
        else if (name === 'text') node.textContent = value;
        else if (value !== null && value !== undefined) node.setAttribute(name, String(value));
      }
      for (const child of [].concat(children)) {
        if (child !== null && child !== undefined)
          node.append(typeof child === 'string' ? doc.createTextNode(child) : child);
      }
      return node;
    }
    function button(text, callback, attrs = {}) {
      const node = el('button', { type: 'button', ...attrs }, text);
      node.addEventListener('click', callback);
      // 操作參考面板時保留頁面上的文字選取。
      node.addEventListener('pointerdown', (event) => event.preventDefault());
      return node;
    }
    function keycap(key) {
      return el('kbd', { text: key, title: key });
    }
    function select(options, label) {
      const node = el('select', { 'aria-label': label });
      for (const [value, title] of options) node.append(el('option', { value, text: title }));
      return node;
    }
    function field(label, control, full = false) {
      if (!control.hasAttribute('aria-label')) control.setAttribute('aria-label', label);
      return el('label', { class: `field${full ? ' full' : ''}` }, [
        el('span', { text: label }),
        control,
      ]);
    }
    function link(title, url) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return el('span', { text: title });
        return el('a', {
          href: parsed.href,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: title,
        });
      } catch {
        return el('span', { text: title });
      }
    }
    function config() {
      return api.getConfig();
    }
    function entries() {
      return api.getEntries('active');
    }
    function categoryTitle(id) {
      return categories.find((category) => category.id === id)?.title || id;
    }
    function patchUI(patch) {
      api.patch({ ui: { ...config().ui, ...patch } });
    }
    function patchFavorite(id) {
      const favoriteSet = new Set(config().favorites);
      if (favoriteSet.has(id)) favoriteSet.delete(id);
      else favoriteSet.add(id);
      api.patch({ favorites: [...favoriteSet] });
    }
    function currentSourceLabel() {
      const cfg = config();
      if (cfg.source !== 'imported' || !cfg.profile) return `預設參考 · ${source.version}`;
      return `個人鍵位 · ${cfg.profile.completeness === 'complete' ? '完整解析' : '部分解析'}`;
    }
    function notify(message, error = false) {
      refs.feedback.textContent = message;
      refs.feedback.dataset.error = String(error);
      clearTimeout(statusTimer);
      statusTimer = setTimeout(() => {
        refs.feedback.textContent = '';
      }, 6500);
    }
    async function copyText(text, success = '已複製。') {
      try {
        await api.copy(text);
        notify(success);
      } catch (error) {
        notify(`無法複製：${error.message || error}`, true);
      }
    }
    function activeWithin(container) {
      const active = shadow.activeElement;
      return active && container?.contains(active) ? active : null;
    }
    function blurWithin(container) {
      activeWithin(container)?.blur?.();
    }
    function close() {
      blurWithin(refs.dialog);
      modalOpen = false;
      refs.dialog.hidden = true;
    }
    function formatOptions(options) {
      if (typeof options === 'string') return options;
      if (!options || !Object.keys(options).length) return '';
      return JSON.stringify(options);
    }
    function clamp(position) {
      const width = refs.card.offsetWidth || 320;
      const height = refs.card.offsetHeight || 300;
      return {
        x: Math.max(8, Math.min(position.x, Math.max(8, innerWidth - width - 8))),
        y: Math.max(8, Math.min(position.y, Math.max(8, innerHeight - height - 8))),
      };
    }
    function positionCard() {
      const saved = dragPosition || config().ui.position;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        const position = clamp(saved);
        Object.assign(refs.card.style, {
          left: `${position.x}px`,
          top: `${position.y}px`,
          bottom: 'auto',
        });
      } else Object.assign(refs.card.style, { left: '18px', top: 'auto', bottom: '18px' });
    }

    const host = el('div', { id: 'vimium-c-companion-ui' });
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483645;pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'open' });
    const styles = `
      :host { all:initial; font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang TC","Noto Sans TC",sans-serif; color-scheme:light; --paper:#fbf9f3; --surface:#fffefb; --ink:#29362e; --muted:#788077; --line:#dfe2d8; --accent:#3a6850; --tint:#e8efe3; --key:#f0f2e9; --gold:#aa7935; --error:#ad4544; --mono:ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace; --shadow:0 15px 60px #283c2826,0 2px 8px #283c2812; }
      :host([data-theme="dark"]) { color-scheme:dark; --paper:#202923; --surface:#28322a; --ink:#e8ede1; --muted:#a9b3a2; --line:#435042; --accent:#b2d0a2; --tint:#344b36; --key:#354132; --gold:#d8b375; --error:#ffafaa; --shadow:0 15px 60px #0005,0 2px 8px #0003; }
      @media(prefers-color-scheme:dark) { :host([data-theme="system"]) { color-scheme:dark; --paper:#202923; --surface:#28322a; --ink:#e8ede1; --muted:#a9b3a2; --line:#435042; --accent:#b2d0a2; --tint:#344b36; --key:#354132; --gold:#d8b375; --error:#ffafaa; --shadow:0 15px 60px #0005,0 2px 8px #0003; } }
      *,*::before,*::after { box-sizing:border-box; } [hidden] { display:none !important; }
      button,input,select,textarea { font:inherit; color:inherit; }
      button { border:0; border-radius:7px; padding:6px 9px; background:transparent; cursor:pointer; line-height:1.35; }
      button:hover { background:var(--tint); } button:disabled { opacity:.45; cursor:default; }
      button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,a:focus-visible,[tabindex]:focus-visible,summary:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
      input,select,textarea { min-width:0; border:1px solid var(--line); border-radius:7px; background:var(--surface); padding:8px 9px; }
      input[type=checkbox] { accent-color:var(--accent); } input[type=file] { width:100%; font-size:11px; }
      textarea { width:100%; min-height:154px; resize:vertical; font:12px/1.6 var(--mono); }
      a { color:var(--accent); text-underline-offset:3px; } p { margin:7px 0; } h2,h3 { margin:0; } h3 { font-size:14px; }
      kbd { display:inline-block; min-width:22px; padding:1px 5px; background:var(--key); color:var(--ink); border:1px solid var(--line); border-bottom-width:2px; border-radius:5px; font:11px/1.6 var(--mono); white-space:nowrap; }
      code,pre { font:11px/1.6 var(--mono); } pre { white-space:pre-wrap; overflow-wrap:anywhere; padding:10px; background:var(--surface); border:1px solid var(--line); border-radius:8px; margin:9px 0; }
      .surface { position:fixed; background:var(--paper); border:1px solid var(--line); border-radius:15px; color:var(--ink); box-shadow:var(--shadow); pointer-events:auto; }
      .card { width:320px; max-width:calc(100vw - 16px); max-height:calc(100vh - 16px); display:flex; flex-direction:column; overflow:hidden; left:18px; bottom:18px; }
      .card-header { padding:13px 13px 10px; display:flex; align-items:center; gap:8px; border-bottom:1px solid var(--line); }
      .drag-handle { flex:1; cursor:grab; touch-action:none; user-select:none; min-width:0; }
      .eyebrow { color:var(--muted); font:10px/1.5 var(--mono); text-transform:uppercase; letter-spacing:.15em; }
      .brand { font-size:18px; letter-spacing:-.02em; line-height:1.4; font-weight:750; }
      .brand span { color:var(--muted); font-weight:400; font-size:12px; letter-spacing:0; margin-left:7px; }
      .icon { min-width:26px; min-height:26px; padding:4px; color:var(--muted); font-size:16px; }
      .card-body { overflow:auto; }
      .source-line { padding:10px 14px 2px; display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
      .source-badge { border-radius:5px; background:var(--tint); color:var(--accent); padding:3px 6px; font-size:10px; }
      .quiet { font-size:10px; color:var(--muted); }
      .practice-header { display:flex; gap:8px; align-items:center; padding:8px 14px; }
      .practice-header select { flex:1; padding:5px 7px; font-size:11px; background:transparent; }
      .practice-header span { color:var(--muted); font-size:10px; }
      .card-rows { padding:0 10px 6px; }
      .reference-row { display:grid; grid-template-columns:89px minmax(0,1fr) 25px; gap:9px; align-items:start; padding:9px 3px; border-bottom:1px solid var(--line); }
      .reference-row:last-child { border-bottom:0; }
      .row-keys { display:flex; flex-wrap:wrap; align-items:center; gap:4px; padding-top:1px; }
      .row-title { font-size:12px; line-height:1.45; }
      .row-command { color:var(--muted); font:10px/1.45 var(--mono); overflow-wrap:anywhere; margin-top:3px; }
      .favorite { color:var(--muted); font-size:15px; padding:1px 3px; width:24px; height:24px; line-height:1; }
      .favorite[aria-pressed=true] { color:var(--gold); }
      .recipe { margin:3px 14px 12px; padding:10px; border:1px solid var(--line); border-radius:9px; background:var(--surface); }
      .recipe-label { font:10px/1.5 var(--mono); color:var(--accent); letter-spacing:.05em; margin-bottom:4px; }
      .recipe-content { color:var(--muted); font-size:11px; display:flex; gap:4px; flex-wrap:wrap; align-items:center; }
      .recipe-content kbd { font-size:10px; }
      .card-footer { border-top:1px solid var(--line); display:flex; align-items:center; gap:3px; padding:7px 8px; }
      .card-footer button { color:var(--muted); font-size:11px; } .card-footer button:first-child { color:var(--accent); margin-right:auto; }
      .dialog { width:min(790px,calc(100vw - 32px)); max-height:calc(100vh - 36px); right:18px; bottom:18px; display:flex; flex-direction:column; overflow:hidden; }
      .dialog-header { display:flex; align-items:center; gap:10px; padding:17px 20px 13px; border-bottom:1px solid var(--line); }
      .dialog-title { flex:1; min-width:0; } .dialog-title h2 { font-size:20px; letter-spacing:-.025em; line-height:1.5; } .dialog-title p { margin:2px 0 0; color:var(--muted); font-size:11px; }
      .dialog-nav { display:flex; gap:4px; padding:8px 15px; border-bottom:1px solid var(--line); } .dialog-nav button { color:var(--muted); font-size:12px; } .dialog-nav button[aria-pressed=true] { background:var(--tint); color:var(--accent); }
      .dialog-content { overflow:auto; padding:16px 20px 20px; }
      .catalog-toolbar { display:grid; grid-template-columns:minmax(0,1fr) 140px; gap:9px; align-items:center; }
      .catalog-toolbar input { width:100%; }
      .catalog-meta { display:flex; flex-wrap:wrap; align-items:center; gap:8px; justify-content:space-between; margin:10px 0; color:var(--muted); font-size:11px; }
      .catalog-meta label { display:flex; align-items:center; gap:5px; }
      .catalog-results .reference-row { grid-template-columns:145px minmax(0,1fr) 26px; padding:13px 3px; }
      .catalog-results .row-title { font-size:13px; font-weight:600; }
      .row-description { font-size:12px; color:var(--muted); margin:4px 0; }
      .entry-meta { display:flex; gap:6px; flex-wrap:wrap; color:var(--muted); font-size:10px; }
      .tag { border:1px solid var(--line); padding:1px 5px; border-radius:4px; }
      details { margin-top:6px; font-size:11px; color:var(--muted); } summary { cursor:pointer; }
      .binding-detail { border-left:2px solid var(--line); padding:5px 0 5px 9px; margin:7px 0; overflow-wrap:anywhere; }
      .empty { padding:12px 3px; color:var(--muted); font-size:12px; }
      .field { display:flex; flex-direction:column; gap:5px; font-size:12px; }
      .field > span { color:var(--muted); } .fields { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; } .full { grid-column:1/-1; }
      .section { padding-bottom:19px; margin-bottom:19px; border-bottom:1px solid var(--line); } .section:last-child { margin-bottom:0; padding-bottom:0; border:0; } .section h3 { margin-bottom:8px; }
      .muted { font-size:12px; color:var(--muted); } .actions { display:flex; flex-wrap:wrap; align-items:center; gap:7px; margin-top:10px; }
      .primary { background:var(--accent); color:var(--paper); padding:7px 11px; } .primary:hover { background:var(--accent); filter:brightness(1.1); } .outline { border:1px solid var(--line); }
      .feedback { min-height:18px; color:var(--accent); font-size:12px; margin:0 0 8px; overflow-wrap:anywhere; } .feedback[data-error=true],.warning { color:var(--error); }
      .import-preview { padding:11px; border:1px solid var(--line); background:var(--surface); border-radius:8px; margin-top:10px; font-size:12px; }
      .preview-heading { font-weight:650; color:var(--accent); } .preview-diagnostics { margin:9px 0 0; padding-left:19px; color:var(--muted); font-size:11px; }
      .preview-mappings { margin-top:8px; font:11px/1.6 var(--mono); overflow-wrap:anywhere; }
      .dialog-footer-note { border-top:1px solid var(--line); padding:9px 20px; color:var(--muted); font-size:10px; }
      .source-note { border-top:1px solid var(--line); margin-top:15px; padding-top:11px; color:var(--muted); font-size:10px; }
      @media(max-width:720px) { .dialog { right:8px; left:8px; bottom:8px; width:auto; max-height:calc(100vh - 16px); } .dialog-content { padding:13px; } .catalog-toolbar { grid-template-columns:1fr; } .catalog-results .reference-row { grid-template-columns:100px minmax(0,1fr) 24px; gap:7px; } .fields { grid-template-columns:1fr; } }
      @media(prefers-reduced-motion:no-preference) { button { transition:background-color .12s,color .12s; } }
    `;
    shadow.append(el('style', { text: styles }));
    shadow.addEventListener(
      'compositionstart',
      () => {
        clearTimeout(compositionTimer);
        composing = true;
      },
      true
    );
    shadow.addEventListener(
      'compositionend',
      () => {
        compositionTimer = setTimeout(() => {
          composing = false;
        }, 0);
      },
      true
    );

    refs.card = el('aside', { class: 'surface card', 'aria-label': 'Vimium C Companion 小抄' });
    refs.dragHandle = el(
      'div',
      { class: 'drag-handle', tabindex: '0', role: 'button', 'aria-label': '拖曳小抄；方向鍵移動' },
      [
        el('div', { class: 'eyebrow', text: 'A LITTLE GUIDE, ALWAYS NEAR' }),
        el('div', { class: 'brand' }, ['Vimium C', el('span', { text: 'Companion' })]),
      ]
    );
    refs.dragHandle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = refs.card.getBoundingClientRect();
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: rect.left,
        top: rect.top,
      };
      refs.dragHandle.setPointerCapture(event.pointerId);
    });
    refs.dragHandle.addEventListener('pointermove', (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      dragPosition = clamp({
        x: drag.left + event.clientX - drag.x,
        y: drag.top + event.clientY - drag.y,
      });
      positionCard();
    });
    function finishDrag() {
      if (!drag) return;
      drag = null;
      if (dragPosition) {
        const position = dragPosition;
        dragPosition = null;
        patchUI({ position });
      }
    }
    refs.dragHandle.addEventListener('pointerup', finishDrag);
    refs.dragHandle.addEventListener('pointercancel', finishDrag);
    refs.collapse = button('−', () => patchUI({ collapsed: !config().ui.collapsed }), {
      class: 'icon',
      'aria-label': '收合小抄',
    });
    refs.card.append(el('div', { class: 'card-header' }, [refs.dragHandle, refs.collapse]));
    refs.cardBody = el('div', { class: 'card-body' });
    refs.sourceBadge = el('span', { class: 'source-badge' });
    refs.cardBody.append(
      el('div', { class: 'source-line' }, [
        refs.sourceBadge,
        el('span', { class: 'quiet', text: '參考資料，非即時模式' }),
      ])
    );
    refs.category = select(
      categories.map((category) => [category.id, category.title]),
      '練習分類'
    );
    refs.category.addEventListener('change', () => api.patch({ category: refs.category.value }));
    refs.cardBody.append(
      el('div', { class: 'practice-header' }, [el('span', { text: '今天練習' }), refs.category])
    );
    refs.cardRows = el('div', { class: 'card-rows' });
    refs.recipe = el('div', { class: 'recipe' });
    refs.cardBody.append(refs.cardRows, refs.recipe);
    refs.card.append(
      refs.cardBody,
      el('div', { class: 'card-footer' }, [
        button('完整小抄', () => open('catalog')),
        button('設定', () => open('settings')),
        button('隱藏小抄', () => api.setVisible(false)),
      ])
    );
    shadow.append(refs.card);

    refs.dialog = el('section', {
      class: 'surface dialog',
      role: 'dialog',
      'aria-labelledby': 'vcc-dialog-heading',
      hidden: '',
    });
    refs.heading = el('h2', { id: 'vcc-dialog-heading', tabindex: '-1', text: '完整小抄' });
    refs.dialogSource = el('p');
    refs.dialog.append(
      el('div', { class: 'dialog-header' }, [
        el('div', { class: 'dialog-title' }, [
          el('div', { class: 'eyebrow', text: 'KEEP YOUR HANDS ON THE KEYS' }),
          refs.heading,
          refs.dialogSource,
        ]),
        button('×', close, { class: 'icon', 'aria-label': '關閉 Companion 面板' }),
      ])
    );
    refs.catalogTab = button('完整小抄', () => open('catalog'), { 'aria-pressed': 'true' });
    refs.settingsTab = button('設定', () => open('settings'), { 'aria-pressed': 'false' });
    refs.dialog.append(
      el('nav', { class: 'dialog-nav', 'aria-label': 'Companion 面板' }, [
        refs.catalogTab,
        refs.settingsTab,
      ])
    );
    refs.dialogContent = el('div', { class: 'dialog-content' });
    refs.feedback = el('div', { class: 'feedback', role: 'status', 'aria-live': 'polite' });
    refs.dialogContent.append(refs.feedback);
    buildCatalog();
    buildSettings();
    refs.dialog.append(
      refs.dialogContent,
      el('div', {
        class: 'dialog-footer-note',
        text: 'Esc 返回原生操作；關閉面板可用 ×，也可用 Vimium C 連結提示選取關閉鈕。',
      })
    );
    shadow.append(refs.dialog);
    doc.documentElement.append(host);
    window.addEventListener('resize', positionCard);

    function favoriteButton(entry) {
      const selected = config().favorites.includes(entry.id);
      return button(selected ? '★' : '☆', () => patchFavorite(entry.id), {
        class: 'favorite',
        'aria-label': `${selected ? '取消收藏' : '收藏'}：${entry.title}`,
        'aria-pressed': String(selected),
        title: selected ? '取消收藏' : '加入收藏',
      });
    }
    function makeRow(entry, full = false) {
      const row = el('div', { class: 'reference-row', 'data-entry-id': entry.id });
      const keys = entry.keys || [];
      row.append(
        el(
          'div',
          { class: 'row-keys' },
          keys.length
            ? keys.slice(0, full ? 20 : 3).map(keycap)
            : el('span', { class: 'quiet', text: '未綁定／待確認' })
        )
      );
      const info = el(
        'div',
        { class: 'row-info' },
        el('div', { class: 'row-title', text: entry.title })
      );
      if (full) {
        info.append(el('div', { class: 'row-command', text: entry.id }));
        if (entry.description)
          info.append(el('p', { class: 'row-description', text: entry.description }));
        const tags = [
          categoryTitle(entry.category),
          entry.mode,
          entry.advanced ? '進階' : '',
          entry.status &&
          !['known', 'resolved', 'complete', 'confident', 'default'].includes(entry.status)
            ? entry.status
            : '',
        ].filter(Boolean);
        info.append(
          el(
            'div',
            { class: 'entry-meta' },
            tags.map((tag) => el('span', { class: 'tag', text: tag }))
          )
        );
        const details = el('details', {}, el('summary', { text: '鍵位、選項與來源' }));
        if (entry.bindings?.length) {
          for (const binding of entry.bindings) {
            const detail = el('div', { class: 'binding-detail' }, [
              keycap(binding.key),
              ` · ${binding.mode || 'normal'}${binding.line ? ` · 第 ${binding.line} 行` : ''}`,
            ]);
            if (binding.status) detail.append(el('div', { text: `解析狀態：${binding.status}` }));
            const options = formatOptions(binding.options);
            if (options) detail.append(el('code', { text: options }));
            details.append(detail);
          }
        } else
          details.append(
            el('p', {
              text: keys.length
                ? '此項依目前顯示來源整理。'
                : '目前來源沒有可確定的按鍵；可在 Vimium C 設定中自行綁定。',
            })
          );
        details.append(link('查看官方來源', entry.url || source.url));
        info.append(details);
      }
      row.append(info, favoriteButton(entry));
      return row;
    }
    function keyFor(commandId, description) {
      const command = entries().find((entry) => entry.id === commandId);
      const expectedMode = command?.mode || 'normal';
      const eligible = (command?.bindings || []).filter((binding) => {
        const options = binding.options;
        const noOptions =
          options == null ||
          options === '' ||
          (typeof options === 'object' &&
            !Array.isArray(options) &&
            Object.keys(options).length === 0);
        return (
          binding.mode === expectedMode &&
          ['default', 'resolved'].includes(binding.status) &&
          noOptions
        );
      });
      const key = eligible.find((binding) => !binding.key.startsWith('<'))?.key || eligible[0]?.key;
      return key
        ? keycap(key)
        : el('span', {
            text: description,
            title: '目前沒有可確定且適用於此步驟的鍵位；請對照 Vimium C 設定。',
          });
    }
    function renderRecipe() {
      const id = config().category;
      const recipes = {
        navigation: ['先練習小幅捲動，再移到頁首或頁尾。'],
        hints: [keyFor('LinkHints.activate', '顯示提示'), '→ 選字母 → 由 Vimium C 操作目標'],
        find: [
          keyFor('enterFindMode', '頁內搜尋'),
          '→ 輸入 →',
          keycap('Enter'),
          '→',
          keyFor('enterVisualMode', '選取模式'),
          '→',
          keyFor('visual:wordNext', '擴充選取'),
          '→',
          keyFor('visual:yank', '複製'),
        ],
        visual: [
          keyFor('LinkHints.activateSelect', '選文字提示'),
          '→ 選提示 →',
          keyFor('visual:wordNext', '擴充選取'),
          '擴充選取 →',
          keyFor('visual:yank', '複製'),
        ],
        tabs: [
          keyFor('nextTab', '下一個分頁'),
          '切換 →',
          keyFor('removeTab', '關閉分頁'),
          '關閉 →',
          keyFor('restoreTab', '恢復分頁'),
          '恢復',
        ],
        vomnibar: [
          keyFor('Vomnibar.activate', '開啟 Vomnibar'),
          '→ 網址／搜尋詞 →',
          keyFor('vomnibar:confirm', '確認'),
        ],
        coexist: [
          keyFor('enterInsertMode', 'Insert'),
          '讓網頁接手；',
          keycap('Esc'),
          '離開原生 Insert。',
        ],
        advanced: ['先看 options 與適用模式，再對照原始鍵位設定。'],
        favorites: ['把最常查的幾個操作收在這裡，慢慢練成習慣。'],
      };
      refs.recipe.replaceChildren(
        el('div', { class: 'recipe-label', text: '小練習' }),
        el('div', { class: 'recipe-content' }, recipes[id] || ['選一個操作，交給 Vimium C 練習。'])
      );
    }
    function buildCatalog() {
      refs.catalog = el('section', { class: 'catalog-view', 'aria-label': '指令參考' });
      refs.search = el('input', {
        type: 'search',
        placeholder: '搜尋中文、英文指令或鍵位…',
        'aria-label': '搜尋 Vimium C 指令',
        autocomplete: 'off',
        spellcheck: 'false',
      });
      refs.search.addEventListener('input', () => {
        query = refs.search.value;
        renderCatalog();
      });
      refs.catalogCategory = select(
        [['all', '全部分類'], ...categories.map((category) => [category.id, category.title])],
        '完整小抄分類'
      );
      refs.catalogCategory.addEventListener('change', () => {
        catalogCategory = refs.catalogCategory.value;
        renderCatalog();
      });
      refs.advanced = el('input', { type: 'checkbox', 'aria-label': '顯示進階與未綁定指令' });
      refs.advanced.checked = true;
      refs.advanced.addEventListener('change', () => {
        showAdvanced = refs.advanced.checked;
        renderCatalog();
      });
      refs.catalogCount = el('span', { 'aria-live': 'polite' });
      refs.catalogResults = el('div', { class: 'catalog-results' });
      refs.catalog.append(
        el('div', { class: 'catalog-toolbar' }, [refs.search, refs.catalogCategory]),
        el('div', { class: 'catalog-meta' }, [
          refs.catalogCount,
          el('label', {}, [refs.advanced, '進階與未綁定']),
        ]),
        refs.catalogResults,
        el('div', { class: 'source-note' }, [
          '資料來源：',
          link(`Vimium C ${source.version}`, source.url),
          ` · ${String(source.commit || '').slice(0, 8)}。顯示的鍵位不會改動擴充套件設定。`,
        ])
      );
      refs.dialogContent.append(refs.catalog);
    }
    function renderCatalog() {
      const cfg = config();
      const needle = query.trim().toLocaleLowerCase();
      const filtered = entries().filter((entry) => {
        if (catalogCategory === 'favorites' && !cfg.favorites.includes(entry.id)) return false;
        if (!['all', 'favorites'].includes(catalogCategory) && entry.category !== catalogCategory)
          return false;
        if (!showAdvanced && (entry.advanced || !entry.keys?.length)) return false;
        return (
          !needle ||
          [
            entry.title,
            entry.description,
            entry.id,
            entry.category,
            entry.mode,
            ...(entry.keys || []),
            ...(entry.bindings || []).map(
              (binding) => `${binding.key} ${formatOptions(binding.options)}`
            ),
          ]
            .join(' ')
            .toLocaleLowerCase()
            .includes(needle)
        );
      });
      refs.catalogCount.textContent = `${filtered.length} 項參考`;
      refs.catalogResults.replaceChildren(...filtered.map((entry) => makeRow(entry, true)));
      if (!filtered.length)
        refs.catalogResults.append(
          el('p', {
            class: 'empty',
            text: '沒有符合的項目。試試英文指令名稱、不同分類，或開啟進階項目。',
          })
        );
    }
    function buildSettings() {
      refs.settings = el('section', {
        class: 'settings-view',
        hidden: '',
        'aria-label': 'Companion 設定內容',
      });
      refs.warning = el('p', { class: 'muted warning', hidden: '' });
      refs.settings.append(refs.warning);
      const display = el('section', { class: 'section' }, el('h3', { text: '我的小抄' }));
      refs.theme = select(
        [
          ['system', '跟隨系統'],
          ['light', '米白'],
          ['dark', '石墨'],
        ],
        '外觀'
      );
      refs.theme.addEventListener('change', () => api.patch({ theme: refs.theme.value }));
      refs.source = select(
        [
          ['default', '預設參考'],
          ['imported', '個人鍵位'],
        ],
        '顯示鍵位來源'
      );
      refs.source.addEventListener('change', () => api.patch({ source: refs.source.value }));
      display.append(
        el('div', { class: 'fields' }, [
          field('外觀', refs.theme),
          field('顯示鍵位來源', refs.source),
        ])
      );
      display.append(
        el('p', {
          class: 'muted',
          text: '這裡只調整參考小抄。導覽、搜尋、選取與網站快捷鍵仍由 Vimium C 處理。',
        })
      );
      refs.siteButton = button('', () => api.toggleSite(), { class: 'outline' });
      display.append(
        el('div', { class: 'actions' }, [
          refs.siteButton,
          button('全域隱藏小抄', () => api.setVisible(false), { class: 'outline' }),
          button(
            '重設小抄位置',
            () => {
              dragPosition = null;
              patchUI({ position: null, collapsed: false });
            },
            { class: 'outline' }
          ),
        ])
      );
      display.append(
        el('p', {
          class: 'muted',
          text: '隱藏後可從 userscript manager 選單恢復。本站設定依 origin 保存，不會修改 Vimium C 排除規則。',
        })
      );
      const interaction = button('互動模式：規劃中', () => {}, { class: 'outline' });
      interaction.disabled = true;
      display.append(el('div', { class: 'actions' }, interaction));
      refs.settings.append(display);

      const native = el(
        'section',
        { class: 'section' },
        el('h3', { text: '匯入 Vimium C 個人鍵位' })
      );
      native.append(
        el('p', {
          class: 'muted',
          text: '選擇 Vimium C 匯出的 JSON 檔，或貼上設定 JSON／鍵位文字。先預覽解析結果，再決定是否套用為顯示來源。',
        })
      );
      refs.file = el('input', {
        type: 'file',
        accept: '.json,application/json,text/plain',
        'aria-label': '選擇 Vimium C JSON 檔',
      });
      refs.nativeInput = el('textarea', {
        'aria-label': 'Vimium C 設定 JSON',
        spellcheck: 'false',
        placeholder: '貼上 Vimium C 匯出設定或 keyMappings…',
      });
      refs.nativeInput.addEventListener('input', () => {
        importGeneration++;
        invalidatePreview();
      });
      refs.file.addEventListener('change', async () => {
        const file = refs.file.files?.[0];
        if (!file) return;
        const generation = ++importGeneration;
        try {
          const text = await file.text();
          if (generation !== importGeneration) return;
          refs.nativeInput.value = text;
          invalidatePreview();
          previewImport();
        } catch (error) {
          notify(`檔案無法讀取：${error.message || error}`, true);
        }
      });
      refs.preview = el('div', { class: 'import-preview', hidden: '', 'aria-live': 'polite' });
      refs.apply = button(
        '套用個人鍵位',
        () => {
          if (!preview || previewText !== refs.nativeInput.value) return;
          try {
            api.applyProfile(preview);
            notify(
              `已套用個人鍵位（${preview.completeness === 'complete' ? '完整解析' : '部分解析'}）。`
            );
          } catch (error) {
            notify(error.message || String(error), true);
          }
        },
        { class: 'primary' }
      );
      refs.apply.disabled = true;
      native.append(
        refs.file,
        refs.nativeInput,
        el('div', { class: 'actions' }, [
          button('預覽匯入', previewImport, { class: 'outline' }),
          refs.apply,
        ]),
        refs.preview
      );
      native.append(
        el('p', {
          class: 'muted',
          text: '部分解析會保留待確認項目。條件式設定、執行環境與未知 options 可能改變實際鍵位；請對照原始設定。此操作只保存 Companion 的參考資料。',
        })
      );
      refs.settings.append(native);

      const coexist = el('section', { class: 'section' }, el('h3', { text: '與網站快捷鍵共存' }));
      refs.coexistIntro = el('p', { class: 'muted' });
      coexist.append(
        refs.coexistIntro,
        el('p', {
          class: 'muted',
          text: '需要本頁暫停／恢復時，可把下列官方範例貼到 Vimium C 自訂鍵位；F7 會保留為恢復鍵。重新載入或換頁可能重設狀態。',
        }),
        el('pre', { text: statusSnippet }),
        el('div', { class: 'actions' }, [
          button(
            '複製 F7 暫停設定',
            () => copyText(statusSnippet, '已複製；請貼到 Vimium C 自訂鍵位中。'),
            { class: 'outline' }
          ),
          link('官方暫停／恢復說明', statusURL),
        ])
      );
      refs.settings.append(coexist);

      const backup = el('section', { class: 'section' }, el('h3', { text: 'Companion 備份' }));
      backup.append(
        el('p', {
          class: 'muted',
          text: '另行備份外觀、收藏、個人參考鍵位與小抄偏好；這不是 Vimium C 的原生設定匯入。',
        })
      );
      refs.backup = el('textarea', {
        'aria-label': 'Companion 備份 JSON',
        spellcheck: 'false',
        placeholder: '匯出目前 Companion 設定，或貼上先前備份…',
      });
      backup.append(
        refs.backup,
        el('div', { class: 'actions' }, [
          button(
            '匯出 Companion 備份',
            () => {
              refs.backup.value = api.exportBackup();
              download(refs.backup.value);
              notify('已匯出 Companion 備份。');
            },
            { class: 'outline' }
          ),
          button(
            '匯入 Companion 備份',
            () => {
              try {
                api.importBackup(refs.backup.value);
                notify('Companion 備份已驗證並套用。');
              } catch (error) {
                notify(`備份未套用：${error.message || error}`, true);
              }
            },
            { class: 'outline' }
          ),
          button(
            '還原 Companion 預設',
            () => {
              api.reset();
              notify('已還原 Companion 預設；Vimium C 設定未變更。');
            },
            { class: 'outline' }
          ),
        ])
      );
      refs.settings.append(backup);
      refs.dialogContent.append(refs.settings);
    }
    function invalidatePreview() {
      preview = null;
      previewText = '';
      refs.apply.disabled = true;
      refs.preview.hidden = true;
      refs.preview.replaceChildren();
    }
    function previewImport() {
      try {
        const parsed = reference.parseImport(refs.nativeInput.value);
        preview = parsed;
        previewText = refs.nativeInput.value;
        refs.apply.disabled = false;
        refs.preview.hidden = false;
        const complete = parsed.completeness === 'complete';
        refs.preview.replaceChildren(
          el('div', {
            class: 'preview-heading',
            text: `${complete ? '完整解析' : '部分解析'} · ${parsed.label || '個人鍵位'}`,
          }),
          el('p', {
            text: `已解析 ${parsed.summary?.parsed ?? parsed.directives?.length ?? 0} 項 · 待確認 ${parsed.summary?.unresolved ?? parsed.diagnostics?.length ?? 0} 項`,
          })
        );
        if (parsed.version)
          refs.preview.append(
            el('p', {
              class: 'muted',
              text: `來源版本：${parsed.version}${parsed.versionMatch === 'different' ? ' · 與參考版本不同，請確認行為' : ''}`,
            })
          );
        if (parsed.mappings)
          refs.preview.append(
            el('pre', {
              class: 'preview-mappings',
              text: parsed.mappings.split('\n').slice(0, 12).join('\n'),
            })
          );
        if (parsed.diagnostics?.length)
          refs.preview.append(
            el(
              'ul',
              { class: 'preview-diagnostics' },
              parsed.diagnostics.map((diagnostic) =>
                el('li', {
                  text: `${diagnostic.line ? `第 ${diagnostic.line} 行：` : ''}${diagnostic.message}`,
                })
              )
            )
          );
        notify('預覽完成，尚未變更顯示來源。');
      } catch (error) {
        invalidatePreview();
        refs.preview.hidden = false;
        refs.preview.append(
          el('p', { class: 'warning', text: `無法解析：${error.message || error}` })
        );
        notify('匯入尚未套用，請修正內容後重新預覽。', true);
      }
    }
    function download(text) {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const anchor = el('a', { href: url, download: 'vimium-c-companion-backup.json' });
      shadow.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function render() {
      const cfg = config();
      host.dataset.theme = cfg.theme;
      host.dataset.source = cfg.source;
      host.dataset.completeness =
        cfg.source === 'imported' ? cfg.profile?.completeness || 'partial' : 'complete';
      const visible = api.isVisible();
      if (!visible) {
        blurWithin(refs.dialog);
        blurWithin(refs.card);
      }
      host.hidden = !visible;
      host.style.setProperty('display', visible ? 'block' : 'none', 'important');
      refs.sourceBadge.textContent = currentSourceLabel();
      refs.dialogSource.textContent = `${currentSourceLabel()} · Companion 只顯示參考資料`;
      refs.cardBody.hidden = cfg.ui.collapsed;
      refs.collapse.textContent = cfg.ui.collapsed ? '+' : '−';
      refs.collapse.setAttribute('aria-label', cfg.ui.collapsed ? '展開小抄' : '收合小抄');
      refs.collapse.setAttribute('aria-expanded', String(!cfg.ui.collapsed));
      if (shadow.activeElement !== refs.category) refs.category.value = cfg.category;
      const candidates = entries().filter((entry) =>
        cfg.category === 'favorites'
          ? cfg.favorites.includes(entry.id)
          : entry.category === cfg.category
      );
      const order =
        {
          navigation: [
            'scrollDown',
            'scrollUp',
            'scrollPageDown',
            'scrollPageUp',
            'scrollToTop',
            'scrollToBottom',
            'focusInput',
          ],
          hints: [
            'LinkHints.activate',
            'LinkHints.activateOpenInNewTab',
            'LinkHints.activateWithQueue',
            'LinkHints.activateSelect',
            'LinkHints.activateCopyLinkUrl',
            'LinkHints.activateHover',
          ],
          find: ['enterFindMode', 'performFind', 'performBackwardsFind', 'performAnotherFind'],
          visual: [
            'enterVisualMode',
            'visual:wordNext',
            'visual:wordPrevious',
            'visual:left',
            'visual:right',
            'visual:yank',
            'visual:escape',
          ],
          tabs: [
            'nextTab',
            'previousTab',
            'createTab',
            'removeTab',
            'restoreTab',
            'visitPreviousTab',
            'duplicateTab',
          ],
          vomnibar: [
            'Vomnibar.activate',
            'Vomnibar.activateInNewTab',
            'Vomnibar.activateTabs',
            'Vomnibar.activateBookmarks',
            'Vomnibar.activateBookmarksInNewTab',
          ],
          coexist: ['enterInsertMode', 'passNextKey', 'showHelp'],
        }[cfg.category] || [];
      const rank = (entry) => {
        const index = order.indexOf(entry.id);
        return index === -1 ? 100 : index;
      };
      const useful = candidates.filter((entry) => entry.keys?.length && !entry.advanced);
      const selected =
        cfg.category === 'favorites' ? candidates : useful.length ? useful : candidates;
      const rows = [...selected].sort((a, b) => rank(a) - rank(b)).slice(0, 7);
      refs.cardRows.replaceChildren(...rows.map((entry) => makeRow(entry)));
      if (!rows.length)
        refs.cardRows.append(
          el('p', {
            class: 'empty',
            text:
              cfg.category === 'favorites'
                ? '點一下指令旁的 ☆，把常用鍵位收在這裡。'
                : '這個分類目前沒有可確定的鍵位。完整小抄保留所有參考項目。',
          })
        );
      renderRecipe();
      refs.coexistIntro.replaceChildren(
        keyFor('enterInsertMode', '原生 Insert 指令'),
        ' 進入 Vimium C 原生 Insert；原廠 ',
        keycap('Esc'),
        ' 返回。個人重映射請以原設定為準。永久排除網站請在 Vimium C 排除規則中設定。'
      );
      if (shadow.activeElement !== refs.theme) refs.theme.value = cfg.theme;
      refs.source.querySelector('option[value="imported"]').disabled = !cfg.profile;
      if (shadow.activeElement !== refs.source) refs.source.value = cfg.source;
      refs.siteButton.textContent = cfg.sites[location.origin]?.hidden
        ? '恢復本站小抄'
        : '本站隱藏小抄';
      const warning = api.getWarning?.() || '';
      refs.warning.hidden = !warning;
      refs.warning.textContent = warning;
      refs.dialog.hidden = !modalOpen;
      refs.catalog.hidden = view !== 'catalog';
      refs.settings.hidden = view !== 'settings';
      refs.heading.textContent = view === 'catalog' ? '完整小抄' : 'Companion 設定';
      refs.dialog.dataset.view = view;
      refs.catalogTab.setAttribute('aria-pressed', String(view === 'catalog'));
      refs.settingsTab.setAttribute('aria-pressed', String(view === 'settings'));
      if (modalOpen && view === 'catalog') renderCatalog();
      positionCard();
    }
    function open(nextView = 'catalog') {
      view = nextView === 'settings' ? 'settings' : 'catalog';
      modalOpen = true;
      if (!api.isVisible()) api.setVisible(true);
      render();
      (view === 'catalog' ? refs.search : refs.heading).focus({ preventScroll: true });
    }
    function handleKeyDown(event) {
      if (composing || event.isComposing || event.keyCode === 229) return false;
      const target = event.composedPath?.()[0] || shadow.activeElement;
      if (!target || target.getRootNode?.() !== shadow) return false;
      if (event.key === 'Escape') {
        if (modalOpen && refs.dialog.contains(target)) {
          event.preventDefault();
          close();
          return true;
        }
        if (refs.card.contains(target)) {
          event.preventDefault();
          blurWithin(refs.card);
          return true;
        }
      }
      if (target === refs.dragHandle && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const movement = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        }[event.key];
        if (movement) {
          event.preventDefault();
          const rect = refs.card.getBoundingClientRect();
          const step = event.shiftKey ? 30 : 10;
          patchUI({
            position: clamp({
              x: rect.left + movement[0] * step,
              y: rect.top + movement[1] * step,
            }),
          });
          return true;
        }
      }
      return false;
    }
    function destroy() {
      window.removeEventListener('resize', positionCard);
      clearTimeout(compositionTimer);
      clearTimeout(statusTimer);
      host.remove();
    }
    render();
    return { host, render, open, handleKeyDown, destroy };
  }

  if (window.top !== window.self || !/^https?:$/.test(location.protocol)) return;
  const STORAGE_KEY = 'vimiumCCompanionConfig';
  const BACKUP_TYPE = 'Vimium C Companion';
  const reference = createReferenceModel();
  const defaults = () => ({
    schemaVersion: 1,
    theme: 'system',
    category: 'navigation',
    favorites: [],
    source: 'default',
    profile: null,
    sites: {},
    ui: { collapsed: false, position: null, hidden: false },
  });
  const isRecord = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
  const assertConfig = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  function normalizeConfig(value) {
    assertConfig(isRecord(value) && value.schemaVersion === 1, '不支援的 Companion 設定版本');
    const next = defaults();
    assertConfig(['system', 'light', 'dark'].includes(value.theme), '主題設定不正確');
    assertConfig(
      ['favorites', ...reference.categories.map((item) => item.id)].includes(value.category),
      '練習分類不正確'
    );
    assertConfig(['default', 'imported'].includes(value.source), '鍵位來源不正確');
    assertConfig(
      Array.isArray(value.favorites) &&
        value.favorites.length <= 1000 &&
        value.favorites.every((id) => typeof id === 'string' && id.length <= 200),
      '收藏格式不正確'
    );
    assertConfig(
      isRecord(value.sites) && Object.keys(value.sites).length <= 1000,
      '網站設定格式不正確'
    );
    next.theme = value.theme;
    next.category = value.category;
    next.source = value.source;
    next.favorites = [...new Set(value.favorites)];
    for (const [origin, settings] of Object.entries(value.sites)) {
      let url;
      try {
        url = new URL(origin);
      } catch {
        throw new Error('網站設定必須使用完整 origin');
      }
      assertConfig(
        /^https?:$/.test(url.protocol) &&
          url.origin === origin &&
          isRecord(settings) &&
          typeof settings.hidden === 'boolean',
        '網站設定必須是 HTTP(S) origin 與 hidden 布林值'
      );
      next.sites[origin] = { hidden: settings.hidden };
    }
    assertConfig(
      isRecord(value.ui) &&
        typeof value.ui.collapsed === 'boolean' &&
        typeof value.ui.hidden === 'boolean',
      '面板設定格式不正確'
    );
    const position = value.ui.position;
    assertConfig(
      position === null ||
        (isRecord(position) && Number.isFinite(position.x) && Number.isFinite(position.y)),
      '面板位置不正確'
    );
    next.ui = {
      collapsed: value.ui.collapsed,
      hidden: value.ui.hidden,
      position: position ? { x: Math.max(0, position.x), y: Math.max(0, position.y) } : null,
    };
    if (value.profile != null) {
      assertConfig(
        isRecord(value.profile) &&
          typeof value.profile.raw === 'string' &&
          value.profile.raw.length <= 1_000_000,
        '原生設定檔必須含有完整匯入原文'
      );
      // 僅信任匯入原文；備份中的衍生鍵位在此重新解析。
      next.profile = reference.parseImport(value.profile.raw);
    }
    assertConfig(next.source !== 'imported' || next.profile, '尚未匯入原生設定檔');
    return next;
  }
  let config = defaults();
  let startupWarning = '';
  try {
    config = normalizeConfig(GM_getValue(STORAGE_KEY, defaults()));
  } catch (error) {
    startupWarning = `儲存的配置無法載入，暫用預設：${error.message}`;
  }
  let ui;
  let entryCache = new Map();
  function patch(change) {
    const next = normalizeConfig({ ...config, ...change });
    GM_setValue(STORAGE_KEY, next);
    config = next;
    entryCache = new Map();
    startupWarning = '';
    ui?.render();
  }
  function isVisible() {
    return !config.ui.hidden && !config.sites[location.origin]?.hidden;
  }
  function setVisible(visible) {
    patch({
      ui: { ...config.ui, hidden: !visible },
      ...(visible ? { sites: { ...config.sites, [location.origin]: { hidden: false } } } : {}),
    });
  }
  const api = {
    reference,
    getConfig: () => config,
    getWarning: () => startupWarning,
    patch,
    isVisible,
    setVisible,
    toggleSite: () =>
      patch({
        sites: {
          ...config.sites,
          [location.origin]: { hidden: !config.sites[location.origin]?.hidden },
        },
      }),
    getEntries(source = 'active') {
      const selected = source === 'active' ? config.source : source;
      if (!entryCache.has(selected))
        entryCache.set(
          selected,
          reference.resolve(selected === 'imported' ? config.profile : null)
        );
      return entryCache.get(selected);
    },
    applyProfile(profile) {
      assertConfig(isRecord(profile) && typeof profile.raw === 'string', '匯入預覽格式不正確');
      patch({ source: 'imported', profile });
    },
    exportBackup: () => JSON.stringify({ type: BACKUP_TYPE, schemaVersion: 1, config }, null, 2),
    importBackup(text) {
      assertConfig(typeof text === 'string' && text.length <= 2_000_000, '備份檔過大');
      let backup;
      try {
        backup = JSON.parse(text);
      } catch {
        throw new Error('Companion 備份不是有效 JSON');
      }
      assertConfig(
        isRecord(backup) && backup.type === BACKUP_TYPE && backup.schemaVersion === 1,
        '請使用 Companion 備份；Vimium C 原生設定請到「原生設定匯入」'
      );
      const next = normalizeConfig(backup.config);
      patch(next);
    },
    reset: () => patch(defaults()),
    async copy(text) {
      GM_setClipboard(String(text), 'text');
    },
  };

  // 只保護本工具的編輯欄位，不占用 f / j / v / ? 等原生快捷鍵。
  const ownedKeyCycles = new Set();
  function protectInputs(event) {
    const path = event.composedPath();
    const owned = !!ui && path.includes(ui.host);
    const editor =
      owned &&
      path.some(
        (node) =>
          node?.nodeType === 1 && (node.matches('input,textarea,select') || node.isContentEditable)
      );
    const key = event.code || event.key;
    let handled = false;
    if (owned && event.type === 'keydown') handled = ui.handleKeyDown?.(event) === true;
    const protectedCycle = ownedKeyCycles.has(key);
    if (event.type === 'keydown' && (editor || handled)) ownedKeyCycles.add(key);
    if (event.type === 'keyup') ownedKeyCycles.delete(key);
    if (editor || handled || protectedCycle) event.stopImmediatePropagation();
    if (handled) event.preventDefault();
  }
  for (const type of ['keydown', 'keypress', 'keyup'])
    window.addEventListener(type, protectInputs, true);
  window.addEventListener('blur', () => ownedKeyCycles.clear());
  GM_addValueChangeListener(STORAGE_KEY, (_key, _oldValue, value, remote) => {
    if (!remote) return;
    try {
      config = normalizeConfig(value);
      entryCache = new Map();
      startupWarning = '';
    } catch (error) {
      startupWarning = `其他分頁的配置無法載入：${error.message}`;
    }
    ui?.render();
  });
  function open(view) {
    setVisible(true);
    mount();
    ui?.open(view);
  }
  GM_registerMenuCommand('Vimium C Companion：顯示／隱藏小抄', () => setVisible(!isVisible()));
  GM_registerMenuCommand('Vimium C Companion：完整查詢', () => open('catalog'));
  GM_registerMenuCommand('Vimium C Companion：設定', () => open('settings'));
  GM_registerMenuCommand('Vimium C Companion：本網站顯示／隱藏', api.toggleSite);
  function mount() {
    if (!document.documentElement) return;
    if (!ui) ui = createCompanionUI(api);
    else if (!ui.host.isConnected) document.documentElement.append(ui.host);
  }
  mount();
  // 網站換掉 body 或重建 DOM 時保留同一份面板、輸入草稿與設定。
  new MutationObserver(mount).observe(document, { childList: true, subtree: true });
})();
