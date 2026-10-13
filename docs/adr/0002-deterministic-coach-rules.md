# Deterministic coaching rules, not an AI model

Adaptation (Up next, Training paces, Working weight progression, Readiness changes, missed-session handling) is a fixed set of rules in code, not a language model. Rules are free to run, give the same answer for the same history, and can be tested exhaustively; every change is shown as a Suggestion with a one-line reason and is never applied silently. An LLM coach was rejected because it costs money per call and its advice cannot be unit-tested.
