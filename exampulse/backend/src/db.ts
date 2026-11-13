// PostgreSQL Connection Pool for ExamPulse
import { Pool } from 'pg';
import { config } from './config';

export class DatabaseService {
  public pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: 50,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.pool.on('error', (err) => {
      console.error('[PostgreSQL pool error]', err);
    });
  }

  public async query(text: string, params?: any[]): Promise<any> {
    return this.pool.query(text, params);
  }

  public async getCandidateByEmail(email: string) {
    const res = await this.pool.query('SELECT * FROM candidates WHERE email = $1 LIMIT 1', [email]);
    return res.rows[0] || null;
  }

  public async getCandidateById(id: number) {
    const res = await this.pool.query('SELECT * FROM candidates WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] || null;
  }

  public async getExamById(id: number) {
    const res = await this.pool.query('SELECT * FROM exams WHERE id = $1 LIMIT 1', [id]);
    return res.rows[0] || null;
  }

  public async getQuestionsByExamId(examId: number) {
    const res = await this.pool.query(
      'SELECT id, exam_id, question_number, question_type, prompt, options, points FROM questions WHERE exam_id = $1 ORDER BY question_number ASC',
      [examId]
    );
    return res.rows;
  }

  public async writeAuditLog(eventType: string, actorId: number | null, actorRole: string | null, details: any, ip: string | null) {
    try {
      await this.pool.query(
        'INSERT INTO audit_log (event_type, actor_id, actor_role, details, ip_address) VALUES ($1, $2, $3, $4, $5)',
        [eventType, actorId, actorRole, JSON.stringify(details), ip]
      );
    } catch (err) {
      console.error('[Audit Log Error]', err);
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

export const dbService = new DatabaseService();
