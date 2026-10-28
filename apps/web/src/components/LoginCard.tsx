"use client";

import { Alert, Button, Card, Flex, Input, Typography } from "antd";

interface Props {
  errorText: string | null;
  testLogin: boolean;
  signInWithGoogle: () => Promise<void>;
  signInForTests: (formData: FormData) => Promise<void>;
}

export function LoginCard({ errorText, testLogin, signInWithGoogle, signInForTests }: Props) {
  return (
    <Card>
      <Typography.Title level={2} style={{ marginTop: 0 }}>
        Импульс
      </Typography.Title>
      <Typography.Paragraph>
        Сервис сам запустит рекламу вашего бизнеса в Яндексе, будет следить, чтобы не потратить больше бюджета, и каждую неделю рассказывать простыми словами, что
        сделал.
      </Typography.Paragraph>
      {errorText ? <Alert type="warning" showIcon title={errorText} style={{ marginBottom: 16 }} /> : null}
      <form action={signInWithGoogle}>
        <Button type="primary" size="large" block htmlType="submit">
          Войти через Google
        </Button>
      </form>
      {testLogin ? (
        <form action={signInForTests} style={{ marginTop: 24 }} data-testid="test-login">
          <Typography.Text type="secondary">Тестовый вход — только для проверок, без Google</Typography.Text>
          <Flex vertical gap={8} style={{ marginTop: 8 }}>
            <Input name="email" type="email" required placeholder="Почта" aria-label="Почта для тестового входа" />
            <Input name="name" required placeholder="Имя" aria-label="Имя для тестового входа" />
            <Button htmlType="submit">Войти для проверки</Button>
          </Flex>
        </form>
      ) : null}
    </Card>
  );
}
