          // v100/v101/v105：代码助手。进代码模式的三种方式：1) 前端「代码模式」开关（请求里带 code_mode:true，后端不再猜）；2) 消息里出现“改聚合体 / 改就医伴侣”（任何位置）；3) 选了「OpenRouter → 代码助手」。有待推送的修改时回“推 / 不推”也归这里；其余话走聊天
          const rawMsg = String(b.message || "").trim() || lastText;
          const codeForced = b.code_mode === true || b.code_mode === "true" || b.code_mode === 1;
          const codeIn = normProvider(b.provider) === "OpenRouter" && String(b.model || "").trim() === CODE_MODEL_ID, codeKind = codeShortcutKind(rawMsg) || codeShortcutKind(lastText);
          if (codeForced || codeIn || codeKind) {
            let handled = false;
            try {
              const cu = await userFromReq(request, env, url, String(b.token || ""));
              if (!cu) { if (codeForced || codeIn || codeKind === "edit") { await emit("请先登录后再用代码助手。"); handled = true; } }
              else {
                const cr = await codeChatEntry(env, cu, (codeForced || codeKind) ? rawMsg : lastText, msgs, { inCode: codeIn || codeForced, forced: codeForced, project: String(b.code_project || ""), ui: codeForced });
                if (cr) { await emit(cr.reply); handled = true; }
              }
            } catch (e) { await emit("代码助手出错：" + String(e && e.message || e).slice(0, 200)); handled = true; }
            if (handled) {
              if (wantStream) await write("data: [DONE]\n\n"); else await write(JSON.stringify({ choices: [{ message: { role: "assistant", content: collected || "(空回复)" } }] }));
              clearInterval(ping); await writer.close().catch(() => {}); return;
            }
          }
