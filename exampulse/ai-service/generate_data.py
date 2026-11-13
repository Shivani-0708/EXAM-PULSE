"""
Synthetic Examination Data Generator for Collusion Detection
Generates realistic candidate submissions with:
- 10 Questions (8 MCQs with 4 options each, 2 short-text questions)
- Labeled collusion clusters (copying answers with noise, synchronized timing, overlapping tab switches)
- Hard negatives (high-achieving honest candidates with high correct agreement and standard phrasing)
- Deterministic seeding for reproducibility
"""

import json
import random
import os
from typing import Dict, List, Any

def generate_synthetic_dataset(num_candidates: int = 800, seed: int = 42) -> Dict[str, Any]:
    random.seed(seed)
    
    # 8 MCQs (Options A, B, C, D; correct is A)
    # 2 Short-Text questions
    correct_mcqs = {f"q{i}": "A" for i in range(1, 9)}
    options = ["A", "B", "C", "D"]
    wrong_options = ["B", "C", "D"]
    
    honest_text_templates_q9 = [
        "A server-authoritative timer maintains the official countdown on the Redis/backend host, preventing local device manipulation by calculating remaining time against the server clock.",
        "Server-side timers ignore local client clocks. Every API write verifies that the server time has not exceeded the deadline recorded when the attempt was initialized.",
        "The server alone dictates elapsed time. Client devices only receive periodic NTP-style synchronization offsets, while Lua scripts enforce deadlines at the storage layer.",
        "Time enforcement is isolated to the server. Candidates cannot extend their exam window by altering operating system clocks because each answer validates against Redis TIME."
    ]
    
    honest_text_templates_q10 = [
        "Redis Lua scripts execute atomically in a single thread, guaranteeing that reading the old session and registering the new session occurs without race conditions.",
        "Single-threaded Redis execution ensures that Lua scripts run without interleaving, allowing an old active session to be atomically evicted and invalidated.",
        "Atomic Lua execution prevents concurrency bugs during login. The script checks for an existing session token, updates it, and publishes an invalidation event in one step.",
        "Atomicity is achieved via Redis Lua scripts which evaluate completely without interruption, ensuring that only one active session ID remains valid."
    ]
    
    collusion_text_seeds_q9 = [
        "Server timer keeps countdown on redis backend so students cannot change local computer clock and lua script checks deadline.",
        "The server controls time with redis TIME function in lua scripts to stop candidates from hacking the device clock.",
    ]
    
    collusion_text_seeds_q10 = [
        "Lua scripts in redis run single threaded without interruption to replace old session id with new uuid and notify websockets.",
        "Single thread atomic lua script replaces previous session and publishes to channel so multiple devices get kicked out.",
    ]

    candidates = []
    labels = []  # Pairwise labels: (cid1, cid2, is_colluding)
    
    # Divide candidates into collusion groups and honest pools
    # Let's create 25 collusion groups (pairs and trios), totaling ~60 candidates
    collusion_groups = []
    group_id_counter = 1
    
    candidate_id = 1001
    all_candidate_ids = []
    
    # Create collusion groups
    for _ in range(25):
        group_size = random.choice([2, 2, 2, 3])
        group_members = []
        for _ in range(group_size):
            group_members.append(candidate_id)
            all_candidate_ids.append(candidate_id)
            candidate_id += 1
        collusion_groups.append(group_members)
    
    # Remaining candidates are honest
    honest_candidates = []
    while len(all_candidate_ids) < num_candidates:
        honest_candidates.append(candidate_id)
        all_candidate_ids.append(candidate_id)
        candidate_id += 1
        
    exam_start_epoch = 1715000000000 # fixed base timestamp
    
    candidate_data_map = {}
    
    # 1. Generate collusion groups
    for group in collusion_groups:
        # Colluding candidates pick a shared rare wrong answer for 2-3 questions
        rare_wrong_choice = random.choice(wrong_options)
        rare_questions = random.sample([f"q{i}" for i in range(1, 9)], 3)
        base_text_q9 = random.choice(collusion_text_seeds_q9)
        base_text_q10 = random.choice(collusion_text_seeds_q10)
        
        # Shared tab-switch interval (e.g. at minute 15)
        tab_start = exam_start_epoch + random.randint(600000, 1800000)
        tab_duration = random.randint(15000, 45000)
        
        base_timings = {f"q{i}": exam_start_epoch + random.randint(60000, 3000000) for i in range(1, 11)}
        
        for cid in group:
            answers = {}
            answer_times = {}
            for i in range(1, 9):
                qid = f"q{i}"
                if qid in rare_questions:
                    answers[qid] = rare_wrong_choice # Colluding on rare wrong answer
                else:
                    answers[qid] = "A" if random.random() < 0.8 else random.choice(options)
                
                # Highly synchronized timings (within 0.5s - 3s)
                answer_times[qid] = base_timings[qid] + random.randint(-2000, 2000)
            
            # Text answers with slight noise
            def add_noise(text):
                words = text.split()
                if random.random() < 0.4 and len(words) > 5:
                    idx = random.randint(0, len(words) - 1)
                    words[idx] = words[idx] + "!" if random.random() < 0.5 else words[idx]
                return " ".join(words)
            
            answers["q9"] = add_noise(base_text_q9)
            answers["q10"] = add_noise(base_text_q10)
            answer_times["q9"] = base_timings["q9"] + random.randint(-2500, 2500)
            answer_times["q10"] = base_timings["q10"] + random.randint(-2500, 2500)
            
            tab_hidden_intervals = [
                {"start": tab_start + random.randint(-1500, 1500), "end": tab_start + tab_duration + random.randint(-1500, 1500)}
            ]
            
            cand_info = {
                "candidateId": cid,
                "answers": answers,
                "answerTimes": answer_times,
                "tabHiddenIntervals": tab_hidden_intervals,
                "tabSwitches": random.randint(5, 12),
                "deviceCount": 1 if random.random() < 0.7 else 2,
                "ipAddress": f"192.168.1.{random.choice([10, 11, 12])}"
            }
            candidates.append(cand_info)
            candidate_data_map[cid] = cand_info
            
        # Add positive labels for all pairs within this group
        for i in range(len(group)):
            for j in range(i + 1, len(group)):
                labels.append({"cid1": group[i], "cid2": group[j], "label": 1, "groupId": group[0]})

    # 2. Generate honest candidates (including hard negatives)
    for cid in honest_candidates:
        is_hard_negative = random.random() < 0.25 # 25% are strong students
        answers = {}
        answer_times = {}
        
        for i in range(1, 9):
            qid = f"q{i}"
            if is_hard_negative:
                answers[qid] = "A" if random.random() < 0.95 else random.choice(wrong_options)
            else:
                answers[qid] = "A" if random.random() < 0.65 else random.choice(options)
            
            # Independent random timings
            answer_times[qid] = exam_start_epoch + random.randint(30000, 3500000)
            
        answers["q9"] = random.choice(honest_text_templates_q9)
        answers["q10"] = random.choice(honest_text_templates_q10)
        answer_times["q9"] = exam_start_epoch + random.randint(30000, 3500000)
        answer_times["q10"] = exam_start_epoch + random.randint(30000, 3500000)
        
        tab_switches = random.randint(0, 3)
        tab_hidden = []
        if tab_switches > 0:
            t_start = exam_start_epoch + random.randint(100000, 3000000)
            tab_hidden.append({"start": t_start, "end": t_start + random.randint(2000, 8000)})
            
        cand_info = {
            "candidateId": cid,
            "answers": answers,
            "answerTimes": answer_times,
            "tabHiddenIntervals": tab_hidden,
            "tabSwitches": tab_switches,
            "deviceCount": 1,
            "ipAddress": f"10.0.{random.randint(1, 250)}.{random.randint(1, 250)}"
        }
        candidates.append(cand_info)
        candidate_data_map[cid] = cand_info

    # Generate negative pair labels (honest vs honest, and honest vs colluder)
    sampled_negative_pairs = set()
    num_negatives = len(labels) * 5 # Realistic imbalanced ratio (1 positive to 5 negatives)
    
    while len(sampled_negative_pairs) < num_negatives:
        c1 = random.choice(all_candidate_ids)
        c2 = random.choice(all_candidate_ids)
        if c1 == c2:
            continue
        p = tuple(sorted([c1, c2]))
        # Ensure not in collusion groups
        is_pos = any(set(p).issubset(set(g)) for g in collusion_groups)
        if not is_pos and p not in sampled_negative_pairs:
            sampled_negative_pairs.add(p)
            labels.append({"cid1": p[0], "cid2": p[1], "label": 0, "groupId": f"neg_{p[0]}"})

    os.makedirs("data", exist_ok=True)
    with open("data/synthetic_candidates.json", "w") as f:
        json.dump(candidates, f, indent=2)
    with open("data/synthetic_labels.json", "w") as f:
        json.dump(labels, f, indent=2)
        
    print(f"Generated {len(candidates)} candidates, {len(labels)} labeled pairs ({sum(1 for l in labels if l['label'] == 1)} positive collusion pairs).")
    return {"candidates": candidates, "labels": labels}

if __name__ == "__main__":
    generate_synthetic_dataset()
